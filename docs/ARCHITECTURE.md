# Tackl — Architecture, User Flow & Data Flow

Companion to [`PRODUCT_SPEC.md`](../PRODUCT_SPEC.md). These diagrams are Mermaid — they render
natively on GitHub. Keep them updated alongside the spec when the architecture changes.

## 1. System architecture

```mermaid
graph TB
    subgraph Browser["Browser (client)"]
        HTML["index.html"]
        Renderer["renderer.js<br/>(chat entry, matrix UI, drag/drop)"]
        AuthJS["auth.js<br/>(Firebase Auth SDK)"]
        ApiJS["api.js<br/>(fetch client, Firestore-backed)"]
        LocalStore["local-store.js<br/>(localStorage, guest mode)"]
        GoogleApi["google-api.js<br/>(Calendar/Tasks calls)"]
    end

    subgraph CloudRun["Google Cloud Run — service: tackl (asia-southeast1)"]
        Express["server.js (Express)<br/>static files + /api/tasks REST + auth middleware"]
        DB["db.js<br/>Firestore data layer"]
    end

    subgraph Firebase["Firebase (project: navalthakur)"]
        FireAuth["Firebase Authentication<br/>(email/password, Google)"]
        Firestore["Firestore (Native mode)<br/>users/{uid}/tasks/{taskId}"]
        FireHosting["navalthakur.firebaseapp.com<br/>(OAuth popup handler only)"]
    end

    subgraph GoogleAPIs["Google APIs (called directly from browser)"]
        Calendar["Calendar API"]
        Tasks["Google Tasks API"]
    end

    subgraph CICD["CI/CD"]
        GHA["GitHub Actions<br/>.github/workflows/deploy.yml"]
        AR["Artifact Registry<br/>(Docker images)"]
    end

    Renderer --> ApiJS
    Renderer --> LocalStore
    Renderer --> GoogleApi
    AuthJS <--> FireAuth
    AuthJS -.->|popup redirect| FireHosting
    ApiJS -->|"fetch + Bearer ID token"| Express
    Express -->|verifyIdToken| FireAuth
    Express --> DB
    DB --> Firestore
    GoogleApi -.->|"Bearer OAuth access token"| Calendar
    GoogleApi -.->|"Bearer OAuth access token"| Tasks

    GHA -->|build & push image| AR
    GHA -->|deploy| CloudRun
```

**Key architectural decisions:**
- The browser **never talks to Firestore directly** — `firestore.rules` denies all direct client
  access. Every read/write goes through `server.js`, which verifies the caller's Firebase ID token
  first.
- **Guest mode is entirely client-side** (`local-store.js`, `localStorage`) — no server round-trip,
  no account needed.
- **Google Calendar/Tasks calls bypass the server entirely** — the browser calls Google's
  APIs directly with a short-lived OAuth access token. The server only persists the small resulting
  metadata (event ID, etc.) afterward.

## 2. User flow

```mermaid
flowchart TD
    Start(["Visit tackl.nthakur.com"]) --> Guest["Guest mode\n(localStorage, fully usable)"]
    Guest --> AddTask["Type task in chat box"]
    AddTask --> AskImportant{"Important?"}
    AskImportant --> AskUrgent{"Urgent?"}
    AskUrgent --> Quadrant["Task filed into Q1–Q4"]
    Quadrant --> Actions["Complete / Edit / Delete / Drag to reorder"]

    Guest --> SignInPrompt["Click 'Sign in' (top-right popover)"]
    SignInPrompt --> Choice{"Email/password\nor Google?"}
    Choice -->|Create account / Sign in| EmailAuth["Firebase email/password"]
    Choice -->|Sign in with Google| GoogleAuth["Firebase Google sign-in"]
    EmailAuth --> Migrate["Guest tasks migrate\ninto Firestore account"]
    GoogleAuth --> Migrate
    Migrate --> SignedIn["Signed-in session\n(tasks now in Firestore)"]
    SignedIn --> Actions

    Quadrant -->|"Q3: Delegate"| Delegate["mailto: link opens\nrecipient's email pre-filled"]
    Quadrant -->|"Q2: Schedule (Google sign-in only)"| Schedule["Pick datetime →\nreal Google Calendar event created"]
    SignedIn -->|"Backup (Google sign-in only)"| Backup["Mirror task list into\nGoogle Tasks list 'Tackl'"]
```

## 3. Data flow: task CRUD (signed-in user)

```mermaid
sequenceDiagram
    participant U as User
    participant R as renderer.js
    participant A as api.js
    participant S as server.js
    participant FA as Firebase Auth (Admin SDK)
    participant D as db.js
    participant F as Firestore

    U->>R: Adds/edits/moves/deletes a task
    R->>A: getAllTasks() / addTask() / moveTask() / ...
    A->>A: getIdToken() from signed-in Firebase user
    A->>S: fetch /api/tasks* with Authorization: Bearer <ID token>
    S->>FA: verifyIdToken(token)
    FA-->>S: decoded token → uid
    S->>D: db.<operation>(uid, ...)
    D->>F: read/write users/{uid}/tasks/{taskId}
    F-->>D: result
    D-->>S: result
    S-->>A: JSON response
    A-->>R: updated task list
    R-->>U: matrix UI re-rendered
```

## 4. Data flow: guest mode (no account)

```mermaid
sequenceDiagram
    participant U as User
    participant R as renderer.js
    participant L as local-store.js
    participant LS as Browser localStorage

    U->>R: Adds/edits/moves/deletes a task
    R->>L: getAllTasks() / addTask() / moveTask() / ...
    L->>LS: read/write key "tackl:guestTasks"
    LS-->>L: current guest task array
    L-->>R: updated task list
    R-->>U: matrix UI re-rendered

    Note over U,LS: Nothing leaves the browser. No server call, no account needed.
```

## 5. Data flow: sign-in and guest → account migration

```mermaid
sequenceDiagram
    participant U as User
    participant R as renderer.js
    participant Au as auth.js
    participant FA as Firebase Auth
    participant L as local-store.js
    participant A as api.js (Firestore-backed)

    U->>Au: signIn() / signUp() / signInWithGoogle()
    Au->>FA: Firebase Authentication request
    FA-->>Au: signed-in user + ID token (auto-refreshed by SDK)
    Au-->>R: onAuthStateChanged(user)
    R->>L: getAllTasks() — read any guest tasks
    alt guest tasks exist
        loop each guest task
            R->>A: addTask(...) [+ setCompleted if done]
        end
        R->>L: clearAll()
    end
    R->>R: store = remoteApi (switch off localStorage)
    R-->>U: Firestore-backed task list rendered
```

## 6. CI/CD pipeline

```mermaid
flowchart LR
    Dev["git push to main"] --> GHA["GitHub Actions workflow\n(.github/workflows/deploy.yml)"]
    GHA --> WIF["Authenticate via Workload Identity\nFederation (no stored key)"]
    WIF --> Build["docker build"]
    Build --> Push["Push image to\nArtifact Registry (asia-southeast1)"]
    Push --> Deploy["gcloud run deploy"]
    Deploy --> Live["Cloud Run service 'tackl'\nlive at tackl.nthakur.com"]
```

## 7. Data model (Firestore)

```mermaid
erDiagram
    USER ||--o{ TASK : owns
    USER {
        string uid PK
    }
    TASK {
        string id PK
        string text
        int important "0 or 1"
        int urgent "0 or 1"
        int completed "0 or 1"
        int position "order within quadrant"
        timestamp createdAt
        string delegatedTo
        timestamp delegatedAt
        string calendarEventId
        string calendarEventLink
        timestamp scheduledAt
        string googleTaskId
    }
```

Path: `users/{uid}/tasks/{taskId}` — a subcollection per user, so isolation is structural, not just
rule-based (though `firestore.rules` also denies all direct client access as defense in depth).
