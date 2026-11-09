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

# Exit on error
set -e

# Load configuration and export it to the helper scripts
if [[ ! -f configuration.env ]]; then
  echo "Error: configuration.env not found. Copy configuration.env.template and fill it in."
  exit 1
fi
set -a
# shellcheck source=/dev/null
source configuration.env
set +a

# Check if variables are set
if [[ -z "$GCP_PROJECT_ID" ]]; then
  echo "Error: Please set your GCP_PROJECT_ID in configuration.env"
  exit 1
fi

if [[ -z "$GCS_BUCKET_NAME" ]]; then
  echo "Error: Please set your GCS_BUCKET_NAME in configuration.env"
  exit 1
fi

if [[ -z "$REGION" ]]; then
  echo "Error: Please set your REGION in configuration.env"
  exit 1
fi

if [[ -z "$CLOUD_RUN_REGION" ]]; then
  echo "Error: Please set your CLOUD_RUN_REGION in configuration.env"
  exit 1
fi

if [[ -z "$SERVICE_NAME" ]]; then
  echo "Error: Please set your SERVICE_NAME in configuration.env"
  exit 1
fi

# Fail fast: Run local lint and build to catch errors before uploading to Cloud Build
echo "Starting local pre-flight checks..."
npm install
npm run build
echo "Local build check passed! Proceeding to Cloud Build..."

# Run setup script to enable APIs, create Artifact Registry and GCS resources, and bind IAM roles
echo "Running setup script..."
bash ./setup.sh

# Define the Artifact Registry image path
IMAGE_NAME="${CLOUD_RUN_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}"

# Build and push the Docker image using Google Cloud Build
gcloud builds submit --tag "$IMAGE_NAME" --project="$GCP_PROJECT_ID"

# Construct the service account email
SERVICE_ACCOUNT_EMAIL="${SERVICE_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

# Create a YAML version of the configuration for gcloud. It is removed again on exit, even if
# the deployment fails.
# IAP_MEMBERS only controls access and is not needed inside the container.
trap 'rm -f env.yaml' EXIT
grep -v -e '^#' -e '^IAP_MEMBERS=' -e '^[[:space:]]*$' configuration.env | sed 's/=/:\ /' > env.yaml

# Deploy the image to Google Cloud Run
gcloud beta run deploy "$SERVICE_NAME" \
  --project="$GCP_PROJECT_ID" \
  --image "$IMAGE_NAME" \
  --region "$CLOUD_RUN_REGION" \
  --env-vars-file=env.yaml \
  --service-account "$SERVICE_ACCOUNT_EMAIL" \
  --no-allow-unauthenticated \
  --iap

# Grant the configured members access now that the IAP resource exists
bash ./grant_access.sh

# Delete the cloudbuild bucket
echo "Deleting cloudbuild bucket..."
gcloud storage rm --recursive "gs://${GCP_PROJECT_ID}_cloudbuild" --project="$GCP_PROJECT_ID" || echo "Warning: Failed to delete bucket gs://${GCP_PROJECT_ID}_cloudbuild"
