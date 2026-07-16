# Tackl — Product Specification & Requirements

This is the master file for what Tackl is, what's shipped, and what's planned. Update it whenever
scope changes — it should stay the single source of truth rather than letting decisions live only
in chat history.

Status legend: `[x]` shipped · `[~]` in progress / partially done · `[ ]` not started.

**Live at:** https://tackl.nthakur.com

**Diagrams:** see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for system architecture, user
flow, and data flow diagrams.

## 1. Product vision

Tackl is a multi-user SaaS task manager built around the **Eisenhower Matrix** (Urgent/Important
decision grid). Tasks are entered conversationally (a chat box asks "important?" / "urgent?") and
land in one of four quadrants. The long-term goal is for each quadrant to connect to a real-world
action, not just a label:

- **Q1 Do First** — no integration needed, act now.
- **Q2 Schedule** — put real time on a real calendar.
- **Q3 Delegate** — hand it to someone else, for real.
- **Q4 Eliminate** — delete or ignore.

## 2. Current state (shipped)

- [x] Core matrix UI + chat-based task entry, drag-and-drop reordering/re-quadranting
      (`src/renderer/renderer.js`, `index.html`, `styles.css`)
- [x] Guest mode — full functionality without an account, backed by `localStorage`
      (`src/renderer/local-store.js`)
- [x] Accounts — Firebase Authentication, email/password + Google sign-in (`src/renderer/auth.js`)
- [x] Guest → account task migration on sign-in
- [x] Per-user data in Firestore (`users/{uid}/tasks/{taskId}`), server-mediated only
      (`src/db.js`, `src/server.js`)
- [x] Firestore security rules deny all direct client access (`firestore.rules`)
- [x] Hosting on Google Cloud Run (project `navalthakur`, region `asia-southeast1`), service URL
      `https://tackl-54h4b3ir2q-as.a.run.app`
- [x] CI/CD: GitHub Actions → Cloud Run on every push to `main`, keyless via Workload Identity
      Federation (`.github/workflows/deploy.yml`, `scripts/setup-gcp-ci.sh`)
- [x] Meaningful auth error messages (no raw Firebase error codes shown to users)
- [x] Custom domain `tackl.nthakur.com` — Cloud Run domain mapping live, DNS propagated, TLS
      certificate provisioned. This is the canonical URL going forward.
- [ ] Google sign-in provider — needs OAuth consent screen test users added for anyone besides the
      project owner while in Testing mode (see §4)

## 3. Planned: Google integrations (Delegate / Schedule / Backup)

Turns the three actionable quadrants into real actions. Full design lives in this section; treat it
as the spec to implement against.

### 3.1 Delegate → `mailto:` link

- No OAuth, no Google API call. Clicking **Delegate** on a task opens a small popover for a
  recipient email + optional note, then builds and opens a `mailto:to@example.com?subject=...&body=...`
  URL.
- Works for **every** user — Google or email/password sign-in, no "connect Google" step.
- Tradeoff: no delivery confirmation. Tackl only knows the mailto link was *opened*, not that the
  email was sent. The task is marked `delegatedTo` / `delegatedAt` at that point (intent, not proof).

### 3.2 Schedule → Google Calendar event

- Google sign-in only. Clicking **Schedule** on a task opens a popover with a native
  `<input type="datetime-local">`, then creates a real event on the user's primary Google Calendar.
- Requires the `https://www.googleapis.com/auth/calendar.events` OAuth scope, requested
  incrementally (not at initial sign-in — only the first time Schedule or Backup is used).
- Task gets `calendarEventId` / `calendarEventLink` / `scheduledAt`; the card shows a calendar-link
  badge.

### 3.3 Backup → Google Tasks

- Google sign-in only. A "Backup to Google Tasks" button (near sign-out) mirrors the current task
  list into a dedicated "Tackl" list in the user's Google Tasks.
- One-way (Tackl → Google Tasks), on-demand — not continuous background sync (no server-side token
  storage, so nothing can run without the tab open).
- Re-running Backup upserts (via a stored `googleTaskId` per task) instead of duplicating.
- Tasks that have been Scheduled (§3.2) carry their `scheduledAt` over as the Google Task's `due`
  date — this is what gives Google Tasks a "timeline" view of Tackl's workload.
- Requires the `https://www.googleapis.com/auth/tasks` OAuth scope, same incremental-auth pattern
  as Schedule.

### 3.4 Architecture

- All three are **client-side only** — the browser calls Google's REST APIs directly
  (`www.googleapis.com/calendar/v3`, `tasks.googleapis.com`) using a Google OAuth access token
  obtained via `GoogleAuthProvider.addScope(...)` + `signInWithPopup`. The access token lives in an
  in-memory variable in a new `src/renderer/google-api.js` — never persisted, session-only, re-requested
  on expiry (~1hr) or next use after a reload.
- The backend (`src/server.js`, `src/db.js`) only persists the small resulting metadata fields
  (`delegatedTo`, `calendarEventId`, `googleTaskId`, etc.) via one new generic endpoint,
  `PATCH /api/tasks/:id/meta` → `db.updateTaskMeta(uid, id, fields)`. It never talks to Google's
  APIs itself.
- CSP already allows this (`connect-src` already covers `*.googleapis.com` from earlier fixes) — no
  further CSP changes expected.

### 3.5 GCP/Console setup required

- [ ] `gcloud services enable calendar-json.googleapis.com tasks.googleapis.com --project=navalthakur`
- [ ] Add `calendar.events` and `tasks` to the OAuth consent screen's scope list
- [ ] Add test-user emails under OAuth consent screen → Test users (Testing mode, max 100, until
      full Google verification is pursued — see §4.4)

### 3.6 Known limitations (by design)

- Schedule/Backup: Google sign-in only.
- Delegate: no send confirmation.
- Access token expiry (~1hr) may require a silent or popup re-consent mid-session.
- Backup is manual/on-demand, not automatic.
- Max 100 test users until Google verification (§4.4) is complete.

## 4. Roadmap: what's missing for a "full-fledged product"

Concrete gaps found while building the current version, plus the broader areas a real product
needs. Roughly ordered by how soon each would actually bite.

### 4.1 Account & auth
- [ ] Password reset flow (only sign in/sign up/Google exist today)
- [x] Account deletion that also deletes the user's Firestore data — `DELETE /api/account`
      (`src/server.js`, `src/db.js`), triggered by the "Delete account" link near sign-out.
      Verified end-to-end: task data and the Firebase Auth user are both actually gone afterward.
- [ ] Email verification (optional, but standard)

### 4.2 Security & reliability
- [ ] Rate limiting on `/api/*` (currently unlimited — a valid token can hammer the API)
- [ ] Input validation/size limits on task text and other fields
- [ ] Error tracking (e.g. Sentry) — right now failures are only visible via `console.error` /
      Cloud Logging, not proactively surfaced
- [ ] Uptime monitoring/alerting on the Cloud Run service
- [ ] Firestore backup/export strategy (Google's redundancy ≠ "undo a bad deploy that corrupted
      data")

### 4.3 Performance & scale
- [ ] Pagination for `getAllTasks` (currently loads the entire list unpaginated — fine at dozens of
      tasks, not at thousands)
- [ ] Firestore read/write cost monitoring as usage grows

### 4.4 Legal & compliance
- [x] Privacy Policy — live at [`/privacy.html`](https://tackl.nthakur.com/privacy.html)
      (`src/renderer/privacy.html`). Drafted to accurately reflect actual data practices; needs a
      legal review before being fully relied on, and the `support@nthakur.com` contact address needs
      to actually exist.
- [x] Terms of Service — live at [`/terms.html`](https://tackl.nthakur.com/terms.html)
      (`src/renderer/terms.html`). Same caveat — legal review still needed, and §10 (governing law)
      is a placeholder that needs a real jurisdiction filled in.
- [ ] GDPR/CCPA considerations if serving EU/CA users
- [ ] Required before pursuing full Google OAuth verification (moves Delegate/Schedule/Backup out of
      the 100-test-user Testing-mode limit in §3.6)

### 4.5 Monetization
- [ ] Decide if/when this becomes a paid product
- [ ] Stripe (or similar) billing integration
- [ ] Pricing tiers + usage-limit enforcement

### 4.6 Collaboration / teams
- [ ] Shared task lists / team accounts
- [ ] Delegation that lands a task in *another Tackl user's* list, not just an email
- [ ] Permissions/roles

### 4.7 Notifications
- [ ] Email reminders for scheduled/urgent tasks
- [ ] Push notifications
- (Without this, Schedule creates a calendar event but nothing proactively reminds the user)

### 4.8 Onboarding & UX
- [ ] First-run tutorial / empty states
- [ ] Mobile/touch support for drag-and-drop (unverified — not tested on a touch screen)
- [ ] Accessibility: keyboard navigation for drag-and-drop, screen reader support

### 4.9 Testing & QA
- [ ] Automated test suite (unit/integration/e2e) — currently zero automated tests
- [ ] CI test gate before deploy (the pipeline currently builds and deploys with no test step)

### 4.10 Analytics
- [ ] Product usage analytics (e.g. PostHog, GA)

### 4.11 Support
- [ ] Support/help channel
- [ ] Docs/changelog for users

## 5. Suggested sequencing

Not a commitment, just a starting recommendation — revisit as priorities change:

1. §4.4 Legal (Privacy Policy + ToS) — blocks both user trust and Google OAuth verification.
2. §3 Google integrations — Delegate first (no dependencies), then Schedule, then Backup.
3. §4.1 Account & auth gaps (password reset, account deletion cleanup) — low effort, real risk if
   skipped.
4. §4.2 Security & reliability basics (rate limiting, error tracking) — before real user growth.
5. Everything else, prioritized by actual user feedback once there are real users.

## 6. Open questions

- Monetization model and timing (§4.5) — not yet decided.
- Whether "Delegate" should eventually become in-app (task lands in another Tackl account) rather
  than email-only (§4.6) — depends on whether teams/collaboration gets prioritized.
- Full Google OAuth verification timeline (§4.4/§3.6) — depends on Legal work and actual usage
  beyond the 100-test-user cap.
