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
- [x] Privacy Policy + Terms of Service (`/privacy.html`, `/terms.html`) — see §4.4
- [x] Self-service account deletion (`DELETE /api/account`) — see §4.1
- [x] Google integrations: Delegate (mailto), Schedule (Calendar), Backup (Google Tasks) — all three
      shipped and verified live — see §3
- [x] Password reset + email verification (see §4.1)
- [x] Rate limiting, input validation, GCP Error Reporting, uptime monitoring/alerting (see §4.2)
- [x] Per-quadrant task loading cap for scale (see §4.3)
- [x] GDPR/CCPA sections in the Privacy Policy (see §4.4)
- [ ] Google sign-in provider — needs OAuth consent screen test users added for anyone besides the
      project owner while in Testing mode (see §4)

## 3. Google integrations (Delegate / Schedule / Backup)

Turns the three actionable quadrants into real actions.

### 3.1 Delegate → `mailto:` link — shipped

- [x] No OAuth, no Google API call. Clicking **Delegate** (✉) on a task opens a popover for a
  recipient email + optional note, then opens a `mailto:to@example.com?subject=...&body=...` URL.
- Works for **every** user — Google or email/password sign-in, no "connect Google" step. Verified
  with Playwright in guest mode: popover opens, mailto URL is built and encoded correctly, and the
  task shows a "✉ recipient@email" badge afterward.
- Tradeoff: no delivery confirmation. Tackl only knows the mailto link was *opened*, not that the
  email was sent. The task is marked `delegatedTo` / `delegatedAt` at that point (intent, not proof).

### 3.2 Schedule → Google Calendar event — shipped, verified live

- [x] Google sign-in only. Clicking **Schedule** (📅) on a task opens a popover with a native
  `<input type="datetime-local">`, then creates a real event (30-minute block) on the user's primary
  Google Calendar. Task gets `calendarEventId` / `calendarEventLink` / `scheduledAt`; the card shows
  a "📅 Calendar" badge linking to the event.
- Non-Google users get a clear message ("Schedule needs a Google account...") instead of the
  popover — verified with Playwright.
- Requires the `https://www.googleapis.com/auth/calendar.events` OAuth scope, requested
  incrementally the first time Schedule or Backup is used in a session.
- **Verified live** 17 Jul 2026 by the project owner: signed in with Google, granted the incremental
  scope, scheduled a task, and confirmed the event actually appears on Google Calendar. Worked
  without needing the consent-screen scope declaration in §3.5 — the project owner has implicit
  access to their own Testing-mode OAuth consent screen regardless of the test-user list.

### 3.3 Backup → Google Tasks — shipped, verified live

- [x] Google sign-in only. A "Backup to Google Tasks" link (near sign-out, Google users only)
  mirrors the current task list into a dedicated "Tackl" list in the user's Google Tasks.
- One-way (Tackl → Google Tasks), on-demand — not continuous background sync (no server-side token
  storage, so nothing can run without the tab open).
- Re-running Backup upserts (via a stored `googleTaskId` per task) instead of duplicating.
- Tasks that have been Scheduled (§3.2) carry their `scheduledAt` over as the Google Task's `due`
  date — this is what gives Google Tasks a "timeline" view of Tackl's workload.
- Requires the `https://www.googleapis.com/auth/tasks` OAuth scope, same incremental-auth pattern
  as Schedule. **Verified live** 17 Jul 2026 by the project owner: confirmed the "Tackl" list and
  its tasks actually appear in Google Tasks.

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

- [x] `gcloud services enable calendar-json.googleapis.com tasks.googleapis.com --project=navalthakur`
- [x] Adding `calendar.events`/`tasks` to the OAuth consent screen's scope list turned out to be
      unnecessary — the live test in §3.2/§3.3 succeeded without it, for the project owner.
- [ ] Add test-user emails under OAuth consent screen → Test users — **still needed for anyone other
      than the project owner**. The project owner has implicit access to their own Testing-mode app
      regardless of the test-user list; other Google accounts will hit a consent-screen block until
      explicitly added (max 100, until full Google verification is pursued — see §4.4).

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
- [x] Password reset flow — "Forgot password?" link in the sign-in popover calls Firebase's
      `sendPasswordResetEmail` (`src/renderer/auth.js`, wired in `renderer.js`). **Verified live**
      17 Jul 2026: triggered a real `PASSWORD_RESET` oob code against the deployed project and
      Firebase confirmed the email was sent.
- [x] Account deletion that also deletes the user's Firestore data — `DELETE /api/account`
      (`src/server.js`, `src/db.js`), triggered by the "Delete account" link near sign-out.
      **Verified live**: task data and the Firebase Auth user are both actually gone afterward
      (confirmed twice — once at initial build, once again after the hardening batch below).
- [x] Email verification — verification email sent automatically on signup
      (`sendEmailVerification`); a dismissable-by-verifying banner nudges unverified users to check
      their inbox or resend, but nothing is blocked/enforced while unverified. Google accounts are
      treated as pre-verified. **Verified live** 17 Jul 2026: triggered a real `VERIFY_EMAIL` oob
      code against the deployed project and Firebase confirmed the email was sent.

### 4.2 Security & reliability
- [x] Rate limiting on `/api/*` — `express-rate-limit`, 120 requests/minute per IP, in-memory
      (`src/server.js`). Per-instance, not shared across Cloud Run replicas — acceptable at current
      traffic; revisit (Firestore- or Redis-backed) if abuse becomes real. **Verified live** 17 Jul
      2026: 130 rapid requests against the deployed site returned 118×200 and 12×429 — the limit
      actually triggers.
- [x] Input validation/size limits — task text capped at 500 characters (`server.js`, `db.js`),
      Google-integration metadata fields capped at 2000 characters, request body capped at 20kb.
      **Verified live**: oversized (600-char) and empty task text both correctly rejected with 400,
      normal text still succeeds with 200.
- [x] Error tracking — GCP Error Reporting (`@google-cloud/error-reporting`), free, no third-party
      account, active in production only (`NODE_ENV=production` set in `Dockerfile`; no-ops locally,
      confirmed by the expected startup warning when run without it). Wired in and deployed; not yet
      *observed* catching a real production error (nothing has failed yet) — will confirm the first
      time something actually breaks, or by manually forcing one.
- [x] Uptime monitoring/alerting — Cloud Monitoring uptime check against `tackl.nthakur.com` every 5
      minutes from multiple regions, with an email alert policy (to navalthakur@gmail.com) on
      failure. Created via `gcloud monitoring uptime create` + `gcloud alpha monitoring policies
      create` (not committed to the repo — lives in GCP console under Monitoring, confirmed present
      via `gcloud monitoring uptime list-configs`). Not yet observed firing a real alert (site hasn't
      gone down since it was set up, which is the point).
- [ ] Firestore backup/export strategy — deliberately skipped for now (no real users yet); revisit
      once there's actual data worth protecting.

### 4.3 Performance & scale
- [x] Safety cap on task loading — not true pagination (this is a 4-quadrant board, not a scrolling
      list, so "page 2" doesn't fit the UX). `getAllTasks` now queries each quadrant separately with
      a 150-task cap per quadrant (`db.js`), so one overloaded quadrant can't starve the other three
      out of the response. `moveTask`/`setCompleted` are intentionally *not* capped — they need the
      full real dataset to re-sequence positions correctly. Shipped and exercised via normal task
      CRUD during verification; **not stress-tested** with an actual 150+-task quadrant (no realistic
      way to generate that safely against the live project right now).
- [ ] Firestore read/write cost monitoring as usage grows

### 4.4 Legal & compliance
- [x] Privacy Policy — live at [`/privacy.html`](https://tackl.nthakur.com/privacy.html)
      (`src/renderer/privacy.html`). Drafted to accurately reflect actual data practices; needs a
      legal review before being fully relied on, and the `support@nthakur.com` contact address needs
      to actually exist.
- [x] Terms of Service — live at [`/terms.html`](https://tackl.nthakur.com/terms.html)
      (`src/renderer/terms.html`). Same caveat — legal review still needed, and §10 (governing law)
      is a placeholder that needs a real jurisdiction filled in.
- [x] GDPR/CCPA sections added to the Privacy Policy — international transfer disclosure (data
      lives in Singapore), EU/UK/EEA data-subject rights (access/correct/delete/restrict/port/
      object, right to complain to a supervisory authority), and California CCPA/CPRA rights
      (know/delete/correct/non-discrimination, explicit "we don't sell or share" statement). Still
      not a substitute for actual legal review, especially before serving EU/CA users at real scale.
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

Not a commitment, just a starting recommendation — revisit as priorities change.

Done, in the order originally suggested:

1. ~~§4.4 Legal (Privacy Policy + ToS)~~ — done, plus GDPR/CCPA sections added afterward.
2. ~~§3 Google integrations~~ — Delegate, Schedule, and Backup all shipped and verified live.
3. ~~§4.1 Account & auth gaps~~ — password reset, account-deletion cleanup, and email verification
   all shipped and verified live.
4. ~~§4.2 Security & reliability basics~~ — rate limiting, input validation, error tracking, and
   uptime monitoring all shipped; only Firestore backups deliberately deferred.

Not started:

5. Everything else in §4.5–§4.11 (monetization, teams/collaboration, notifications, onboarding/UX,
   automated testing, analytics, support), prioritized by actual user feedback once there are real
   users. Also: extending OAuth consent-screen access to non-owner users (§3.5) if this needs to
   work for anyone besides the project owner before full Google verification.

## 6. Open questions

- Monetization model and timing (§4.5) — not yet decided.
- Whether "Delegate" should eventually become in-app (task lands in another Tackl account) rather
  than email-only (§4.6) — depends on whether teams/collaboration gets prioritized.
- Full Google OAuth verification timeline (§4.4/§3.6) — depends on Legal work and actual usage
  beyond the 100-test-user cap.
