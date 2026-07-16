# Tackl

**Live at: https://tackl.nthakur.com**

A multi-user SaaS task manager for prioritizing your work with the
**[Eisenhower Matrix](https://en.wikipedia.org/wiki/Time_management#Eisenhower_method)** — the "Urgent–Important" decision grid popularized by Dwight D. Eisenhower.

Instead of filling out forms, you add tasks through a simple chat box: type what you need to do,
answer two quick questions, and the app automatically files the task into the right quadrant with a
priority number.

Tackl runs as a web app on **Google Cloud Run**, with per-user accounts via **Firebase
Authentication** and task data stored in **Firestore**.

> **Product spec & roadmap:** see [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md) for the full requirements —
> what's shipped, what's planned (Gmail delegation, Calendar scheduling, Google Tasks backup), and
> the broader roadmap toward a full product (billing, teams, notifications, legal, etc.). Keep it
> updated as the single source of truth when scope changes.

## What it does

Every task is sorted into one of four quadrants based on whether it's **important** and/or **urgent**:

| Quadrant | Important? | Urgent? | What to do |
| --- | --- | --- | --- |
| **Q1 — Do First** | Yes | Yes | Act on these immediately |
| **Q2 — Schedule** | Yes | No | Designate time to work on these |
| **Q3 — Delegate** | No | Yes | Find someone else to do these |
| **Q4 — Eliminate** | No | No | Delete or reduce these completely |

## Architecture

- **Frontend** (`src/renderer/`): plain HTML/CSS/JS, no build step. Firebase Web SDK is imported
  directly as an ES module from Google's CDN for sign-in; `api.js` talks to the backend over `fetch`,
  attaching the signed-in user's Firebase ID token.
- **Backend** (`src/server.js`): an Express server that serves the frontend as static files and
  exposes a `/api/tasks` REST API. Every request is authenticated by verifying the caller's Firebase
  ID token with the Firebase Admin SDK.
- **Data** (`src/db.js`): Firestore, one `users/{uid}/tasks/{taskId}` collection per user. Firestore
  security rules (`firestore.rules`) deny all direct client access — only the server (via the Admin
  SDK) reads or writes data, after checking the request's uid.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later.
- A [Firebase](https://console.firebase.google.com/) project with **Firestore** and
  **Authentication** (Email/Password and, optionally, Google) enabled.
- The [gcloud CLI](https://cloud.google.com/sdk/docs/install) if you're deploying to Cloud Run.

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set up Firebase for local use:
   - In the [Firebase console](https://console.firebase.google.com/), create (or pick) a project,
     enable **Firestore** (Native mode) and **Authentication** (enable the Email/Password and Google
     sign-in providers).
   - Under Project Settings → Your apps, create a Web app and copy its config into
     `src/renderer/firebase-config.js` (these values are not secret — they identify the project, they
     don't grant access).
   - Authenticate your machine so the Admin SDK can reach Firestore/Auth:

     ```bash
     gcloud auth application-default login --project YOUR_PROJECT_ID
     ```

3. Start the server:

   ```bash
   npm run dev
   ```

   Then open <http://localhost:8080>.

> **Note:** The first time the app queries tasks, Firestore may report that a composite index is
> needed for the `getAllTasks` query (sorted by important, urgent, completed, position). Firestore's
> error message includes a direct console link to create it — click it once and the index builds in
> the background.

## Deploy to Cloud Run

**Automatic (recommended):** every push to `main` builds and deploys via the GitHub Actions
workflow at `.github/workflows/deploy.yml` — see "CI/CD" below for one-time setup.

**Manual:** with the [gcloud CLI](https://cloud.google.com/sdk/docs/install) authenticated and the
project selected:

```bash
gcloud run deploy tackl --source . --region asia-southeast1 --allow-unauthenticated
```

This builds the included `Dockerfile` and deploys it — no separate container registry step needed.
The Cloud Run service's attached service account needs the **Cloud Datastore User** (or Firebase
Admin) IAM role so the Admin SDK can reach Firestore/Auth via Application Default Credentials; no
credentials file is required on Cloud Run itself.

### Custom domain

Tackl is served at `tackl.nthakur.com` via a Cloud Run domain mapping, done once with:

```bash
gcloud beta run domain-mappings create --service=tackl --domain=tackl.nthakur.com \
  --region=asia-southeast1 --project=navalthakur
```

Then add the CNAME record it asks for (`tackl` → `ghs.googlehosted.com.`) at your DNS provider.
Google auto-provisions the TLS certificate once DNS propagates — no further action needed. The
domain also needs to be added to Firebase's authorized domains list (Authentication → Settings →
Authorized domains) or sign-in will fail with `auth/unauthorized-domain`.

Deploy the Firestore security rules once (or whenever `firestore.rules` changes) with the
[Firebase CLI](https://firebase.google.com/docs/cli):

```bash
firebase deploy --only firestore:rules --project navalthakur
```

## CI/CD

Pushes to `main` are built and deployed to Cloud Run automatically by
`.github/workflows/deploy.yml`, authenticating to GCP via **Workload Identity Federation** — no
service account key is stored in GitHub.

One-time setup (only needs to be done once, ever, by someone with owner/editor access to the GCP
project):

1. Open [Cloud Shell](https://shell.cloud.google.com) (already authenticated, no local install
   needed) and run:

   ```bash
   bash scripts/setup-gcp-ci.sh
   ```

   This enables the required APIs, creates the `tackl` Artifact Registry repo, creates a
   `github-deployer` service account scoped to this one repo, and sets up the Workload Identity
   Pool/Provider trust between GitHub Actions and GCP.

2. It prints two values at the end — add them as **repository variables** (Settings → Secrets and
   variables → Actions → Variables) in the GitHub repo:
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`
   - `GCP_SERVICE_ACCOUNT`

3. Also deploy the Firestore security rules once (they're not part of the container image):

   ```bash
   firebase deploy --only firestore:rules --project navalthakur
   ```

After that, every push to `main` deploys automatically — no further setup needed.

## Usage

1. Sign in (or create an account) on the sign-in screen.
2. Type a task in the chat box at the bottom and press **Enter**.
3. Answer **"Is this important?"** and **"Is this urgent?"** with the **Yes / No** buttons.
4. The task lands in the matching quadrant with a priority number.

Drag tasks to reorder them within a quadrant or to move them between quadrants. Hover over a task to
reveal actions to complete (✓), edit (✎), and delete (✕). Quadrants scroll when they fill up.

## Project structure

- `PRODUCT_SPEC.md` — master product specification, requirements, and roadmap
- `src/server.js` — Express app: static file serving, `/api/tasks` REST routes, Firebase ID token
  verification
- `src/db.js` — Firestore data layer, scoped per user: CRUD plus quadrant move/reorder
- `src/renderer/` — frontend (HTML/CSS/JS)
  - `auth.js` — Firebase Authentication (sign in/up/out, Google sign-in)
  - `api.js` — `fetch`-based client for the `/api/tasks` REST API
  - `firebase-config.js` — Firebase web app config (fill in with your project's values)
  - `renderer.js` — auth gating, chat entry flow, drag-and-drop matrix UI
- `Dockerfile` — container image used for Cloud Run deploys
- `firestore.rules` / `firebase.json` — Firestore security rules (deny direct client access)
- `.github/workflows/deploy.yml` — CI/CD: builds and deploys to Cloud Run on every push to `main`
- `scripts/setup-gcp-ci.sh` — one-time script to set up the CI/CD pipeline's GCP-side resources
