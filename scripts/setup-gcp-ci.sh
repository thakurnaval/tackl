#!/usr/bin/env bash
# One-time setup: creates the Artifact Registry repo, deploy service account, and
# Workload Identity Federation trust between this GitHub repo and GCP, so GitHub
# Actions can deploy to Cloud Run without any long-lived credentials.
#
# Run this once, from Cloud Shell (https://shell.cloud.google.com) or any machine
# with `gcloud` installed and authenticated as an owner/editor of the project:
#
#   bash scripts/setup-gcp-ci.sh
#
# At the end it prints two values — paste them back so they can be added as
# GitHub Actions repository variables (GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_SERVICE_ACCOUNT).

set -euo pipefail

PROJECT_ID="navalthakur"
REGION="asia-southeast1"
REPO_OWNER="thakurnaval"
REPO_NAME="tackl"
SERVICE_NAME="tackl"
AR_REPO="tackl"
SA_NAME="github-deployer"
POOL_ID="github"
PROVIDER_ID="tackl-repo"

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Setting active project to ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

echo "==> Enabling required APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com

echo "==> Creating Artifact Registry repo (if it doesn't already exist)"
gcloud artifacts repositories create "${AR_REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Tackl container images" \
  || echo "    (already exists, skipping)"

echo "==> Creating deploy service account (if it doesn't already exist)"
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="GitHub Actions deployer for Tackl" \
  || echo "    (already exists, skipping)"

echo "==> Granting the deploy service account the roles it needs"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet > /dev/null
done

echo "==> Creating Workload Identity Pool (if it doesn't already exist)"
gcloud iam workload-identity-pools create "${POOL_ID}" \
  --location="global" \
  --display-name="GitHub Actions" \
  || echo "    (already exists, skipping)"

echo "==> Creating OIDC Provider restricted to ${REPO_OWNER}/${REPO_NAME} (if it doesn't already exist)"
gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
  --location="global" \
  --workload-identity-pool="${POOL_ID}" \
  --display-name="Tackl repo" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${REPO_OWNER}/${REPO_NAME}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  || echo "    (already exists, skipping)"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"

echo "==> Allowing this GitHub repo to impersonate the deploy service account"
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository/${REPO_OWNER}/${REPO_NAME}" \
  --quiet > /dev/null

WORKLOAD_IDENTITY_PROVIDER="${POOL_RESOURCE}/providers/${PROVIDER_ID}"

cat <<EOF

============================================================
Setup complete. Paste these two values back so they can be
added as GitHub Actions repository variables:

GCP_WORKLOAD_IDENTITY_PROVIDER=${WORKLOAD_IDENTITY_PROVIDER}
GCP_SERVICE_ACCOUNT=${SA_EMAIL}
============================================================
EOF
