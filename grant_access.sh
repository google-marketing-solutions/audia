#!/bin/bash
# Copyright 2026 Google LLC.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Grants the configured members access to the IAP protected Cloud Run service.
#
# The bindings are scoped to the service itself instead of the project, so members do not
# gain access to the other IAP protected services running in the same project.
# IAP only exposes its IAM resource once the service exists, therefore this script has to
# run after the Cloud Run deployment.

set -e

# --- Configuration ---
if [[ -f configuration.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source configuration.env
  set +a
fi

if [[ -z "$GCP_PROJECT_ID" ]] || [[ -z "$SERVICE_NAME" ]] || [[ -z "$CLOUD_RUN_REGION" ]]; then
  echo "Error: Please set GCP_PROJECT_ID, SERVICE_NAME and CLOUD_RUN_REGION in configuration.env"
  exit 1
fi

IAP_ROLE="roles/iap.httpsResourceAccessor"

# The deploying user is always included so that a fresh deployment stays reachable.
CURRENT_USER=$(gcloud config get-value account)
MEMBERS="$IAP_MEMBERS"
if [[ -n "$CURRENT_USER" ]]; then
  MEMBERS="user:${CURRENT_USER},${MEMBERS}"
fi

# Public principals would expose the app, its Gemini quota and its service account to anyone.
if echo "$MEMBERS" | tr ',' '\n' | grep -q -E '^[[:space:]]*(allUsers|allAuthenticatedUsers)[[:space:]]*$'; then
  echo "Error: IAP_MEMBERS must not contain allUsers or allAuthenticatedUsers."
  echo "     Use named principals such as user:alice@example.com or group:team@example.com."
  exit 1
fi

echo "Granting IAP access to '$SERVICE_NAME' in '$CLOUD_RUN_REGION'..."
echo "$MEMBERS" | tr ',' '\n' | sed '/^[[:space:]]*$/d' | while read -r MEMBER; do
  echo "   -> $MEMBER"
  gcloud beta iap web add-iam-policy-binding \
    --resource-type=cloud-run \
    --service="$SERVICE_NAME" \
    --region="$CLOUD_RUN_REGION" \
    --project="$GCP_PROJECT_ID" \
    --member="$MEMBER" \
    --role="$IAP_ROLE" \
    --quiet > /dev/null
done
echo "IAP access granted."

# Only the IAP service agent should be able to invoke the service. Anything else could reach
# the container without passing the IAP login, so it is reported instead of silently ignored.
PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format="value(projectNumber)")
IAP_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com"

echo "Ensuring IAP service agent can invoke '$SERVICE_NAME'..."
gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --region="$CLOUD_RUN_REGION" \
  --project="$GCP_PROJECT_ID" \
  --member="serviceAccount:${IAP_SERVICE_AGENT}" \
  --role="roles/run.invoker" \
  --quiet > /dev/null

echo "Checking who can invoke '$SERVICE_NAME'..."

SERVICE_INVOKERS=$(gcloud run services get-iam-policy "$SERVICE_NAME" \
  --region="$CLOUD_RUN_REGION" \
  --project="$GCP_PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.role=roles/run.invoker AND NOT bindings.members:${IAP_SERVICE_AGENT}" \
  --format="value(bindings.members)")

if [[ -n "$SERVICE_INVOKERS" ]]; then
  echo "Warning: these principals can invoke the service directly:"
  echo "$SERVICE_INVOKERS" | sed 's/^/     /'
  echo "     Remove them so that only IAP can reach the container."
fi

PROJECT_INVOKERS=$(gcloud projects get-iam-policy "$GCP_PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.role=roles/run.invoker AND NOT bindings.members:${IAP_SERVICE_AGENT}" \
  --format="value(bindings.members)")

if [[ -n "$PROJECT_INVOKERS" ]]; then
  echo "Warning: these principals hold 'roles/run.invoker' on the whole project:"
  echo "$PROJECT_INVOKERS" | sed 's/^/     /'
  echo "     IAP still blocks them at the ingress, but the role should be scoped to the"
  echo "     services that actually need it. This project is shared, so review before removing."
fi

echo "Access configuration complete."
