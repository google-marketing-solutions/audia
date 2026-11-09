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

# Prepares the Google Cloud project: enables APIs, creates the Artifact Registry repository,
# configures Cloud Build and runtime service accounts, and creates the upload bucket with
# least-privilege access and a short retention lifecycle.

set -e

# --- Configuration ---
if [[ -f configuration.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source configuration.env
  set +a
fi

if [[ -z "$SERVICE_NAME" ]]; then
  echo "Error: Please set your SERVICE_NAME in configuration.env"
  exit 1
fi

if [[ -z "$GCP_PROJECT_ID" ]]; then
  echo "Error: Please set your GCP_PROJECT_ID in configuration.env"
  exit 1
fi

if [[ -z "$GCS_BUCKET_NAME" ]]; then
  echo "Error: Please set your GCS_BUCKET_NAME in configuration.env"
  exit 1
fi

if [[ -z "$CLOUD_RUN_REGION" ]]; then
  echo "Error: Please set your CLOUD_RUN_REGION in configuration.env"
  exit 1
fi

PROJECT_ID="$GCP_PROJECT_ID"
echo "Starting setup for service '$SERVICE_NAME' in project '$PROJECT_ID'..."

# 1. Enable the required APIs
echo "Enabling required APIs..."
gcloud services enable \
  serviceusage.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iap.googleapis.com \
  aiplatform.googleapis.com \
  videointelligence.googleapis.com \
  texttospeech.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID"

echo "Ensuring IAP service identity exists..."
gcloud beta services identity create \
  --service=iap.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet > /dev/null 2>&1 || echo "Warning: Could not verify IAP service identity; continuing..."

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
if [[ -z "$PROJECT_NUMBER" ]]; then
  echo "Error: Could not retrieve project number for project '$PROJECT_ID'."
  exit 1
fi

# 2. Create the Artifact Registry Docker repository for container images
if ! gcloud artifacts repositories describe "$SERVICE_NAME" \
    --location="$CLOUD_RUN_REGION" \
    --project="$PROJECT_ID" &> /dev/null; then
  echo "Creating Artifact Registry repository '$SERVICE_NAME' in $CLOUD_RUN_REGION..."
  gcloud artifacts repositories create "$SERVICE_NAME" \
    --repository-format=docker \
    --location="$CLOUD_RUN_REGION" \
    --description="Container images for $SERVICE_NAME" \
    --project="$PROJECT_ID"
else
  echo "Artifact Registry repository '$SERVICE_NAME' already exists."
fi

# 3. Grant the project's default Cloud Build service account the roles needed to build and push
# New projects use ${PROJECT_NUMBER}-compute@developer.gserviceaccount.com while older projects
# may still use ${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com.
BUILD_SERVICE_ACCOUNT=$(gcloud builds get-default-service-account --project="$PROJECT_ID" 2>/dev/null || true)
if [[ -z "$BUILD_SERVICE_ACCOUNT" ]]; then
  BUILD_SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi
echo "Granting build and Artifact Registry push roles to Cloud Build service account ($BUILD_SERVICE_ACCOUNT)..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$BUILD_SERVICE_ACCOUNT" \
    --role="roles/storage.objectViewer" \
    --quiet --condition=None > /dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$BUILD_SERVICE_ACCOUNT" \
    --role="roles/logging.logWriter" \
    --quiet --condition=None > /dev/null
gcloud artifacts repositories add-iam-policy-binding "$SERVICE_NAME" \
    --location="$CLOUD_RUN_REGION" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$BUILD_SERVICE_ACCOUNT" \
    --role="roles/artifactregistry.writer" \
    --quiet > /dev/null

# 4. Create the service account the Cloud Run service runs as
SERVICE_ACCOUNT_NAME="$SERVICE_NAME"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Checking for service account: $SERVICE_ACCOUNT_EMAIL..."
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project="$PROJECT_ID" --quiet &> /dev/null; then
  echo "Service account not found. Creating..."
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --display-name="Audia Service Account" \
    --project="$PROJECT_ID"
else
  echo "Service account already exists."
fi

# 5. Project-level roles: Vertex AI and logging only
echo "Granting 'Vertex AI User' and 'Logs Writer' roles to $SERVICE_ACCOUNT_EMAIL..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/aiplatform.user" \
    --quiet --condition=None > /dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/logging.logWriter" \
    --quiet --condition=None > /dev/null

# 6. Upload bucket: storage access is scoped to this bucket instead of the whole project
BUCKET_URL="gs://${GCS_BUCKET_NAME}"
if ! gcloud storage buckets describe "$BUCKET_URL" --project="$PROJECT_ID" &> /dev/null; then
  echo "Creating bucket $BUCKET_URL in $CLOUD_RUN_REGION..."
  gcloud storage buckets create "$BUCKET_URL" \
    --project="$PROJECT_ID" \
    --location="$CLOUD_RUN_REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

echo "Granting 'Storage Object Admin' on $BUCKET_URL to $SERVICE_ACCOUNT_EMAIL..."
gcloud storage buckets add-iam-policy-binding "$BUCKET_URL" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT_EMAIL" \
    --role="roles/storage.objectAdmin" > /dev/null

# Uploaded videos are deleted right after analysis. The lifecycle rule removes anything left
# behind (for example if an instance is shut down mid-request) after one day. Existing lifecycle
# rules are never overwritten.
EXISTING_LIFECYCLE=$(gcloud storage buckets describe "$BUCKET_URL" --project="$PROJECT_ID" --format="value(lifecycle_config)")
if [[ -z "$EXISTING_LIFECYCLE" ]]; then
  echo "Adding a 1-day deletion lifecycle rule for video-intelligence/ uploads..."
  LIFECYCLE_FILE=$(mktemp)
  trap 'rm -f "$LIFECYCLE_FILE"' EXIT
  cat > "$LIFECYCLE_FILE" <<'EOF'
{"rule": [{"action": {"type": "Delete"}, "condition": {"age": 1, "matchesPrefix": ["video-intelligence/"]}}]}
EOF
  gcloud storage buckets update "$BUCKET_URL" --project="$PROJECT_ID" --lifecycle-file="$LIFECYCLE_FILE" > /dev/null
else
  echo "Warning: $BUCKET_URL already has lifecycle rules, which were left unchanged."
  echo "     Add a rule that deletes objects under video-intelligence/ after 1 day."
fi

# Earlier versions granted 'Storage Object Admin' on the whole project. Report it so it can be removed.
if gcloud projects get-iam-policy "$PROJECT_ID" \
    --flatten="bindings[].members" \
    --filter="bindings.role=roles/storage.objectAdmin AND bindings.members:${SERVICE_ACCOUNT_EMAIL}" \
    --format="value(bindings.members)" | grep -q .; then
  echo "Warning: $SERVICE_ACCOUNT_EMAIL still holds project-wide 'Storage Object Admin'. Remove it with:"
  echo "     gcloud projects remove-iam-policy-binding $PROJECT_ID --member=serviceAccount:$SERVICE_ACCOUNT_EMAIL --role=roles/storage.objectAdmin"
fi

echo "Setup complete."
