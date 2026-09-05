# ReachInbox Email Scheduler

A high-performance, distributed background email scheduling, dispatching, and monitoring system built for the ReachInbox Software Development Intern assignment.

The application enables authenticated users to configure multi-sender email campaigns from CSV/TXT recipient lists, enforce sliding-window hourly rate limits and inter-email delays via Redis, index and search sent messages using Elasticsearch with safe client-side snippet highlighting, monitor background dispatch queues via an authenticated Bull Board dashboard, and receive delivery reports via Slack OAuth 2.0.

---

## Architecture & System Design

### Architecture Diagram

```mermaid
flowchart TD
    subgraph ClientLayer["Client Layer"]
        Browser["Web Browser (User)"]
        ReactApp["React 18 + Vite Dashboard\n(Tailwind CSS, Lucide Icons)"]
        Browser --> ReactApp
    end

    subgraph APILayer["API & Ingestion Layer (Port 5000)"]
        Express["Express.js API Server"]
        Passport["Passport.js (Google OAuth 2.0)"]
        SessionStore["Redis Session Store (connect-redis)"]
        CryptoService["AES-256-GCM Token Encryption"]
        BullBoard["Bull Board Dashboard (/admin/queues)"]

        ReactApp -- "REST API (JSON, Credentials Included)" --> Express
        Express --> Passport
        Passport --> SessionStore
        Express --> CryptoService
        Express --> BullBoard
    end

    subgraph StorageLayer["Data & State Infrastructure (Docker)"]
        MySQL[("MySQL 8.0 (Port 3307)\nPrisma ORM Persistence")]
        RedisDB[("Redis 7.0 (Port 6379)\nBullMQ Queue & Sliding Windows")]
        ESIndex[("Elasticsearch 8.15 (Port 9200)\nSent Email Search Index")]
    end

    subgraph WorkerLayer["Distributed Dispatch Engine"]
        Worker["BullMQ Worker Process\n(Concurrency: 5)"]
        RateLimiter["Redis Sliding Window & Delay Limiter"]
        Nodemailer["Nodemailer Multi-Sender Dispatcher"]
        SlackNotifier["Slack Block Kit Idempotent Notifier"]

        Worker --> RateLimiter
        Worker --> Nodemailer
        Worker --> SlackNotifier
    end

    subgraph ExternalServices["External Integrations"]
        GoogleAuth["Google Identity (OAuth 2.0)"]
        EtherealSMTP["Ethereal Multi-Sender SMTP Accounts"]
        SlackOAuth["Slack API (OAuth v2 & Webhooks)"]
        SlackChannels["Slack Workspace Channels"]
    end

    %% API Connections
    Express -- "Transactions & Schemas" --> MySQL
    Express -- "Enqueues Job { emailId }" --> RedisDB
    Express -- "Search Queries" --> ESIndex
    Passport -- "OAuth Flow" --> GoogleAuth
    Express -- "OAuth Code Exchange" --> SlackOAuth

    %% Worker Connections
    RedisDB -- "Job Stream" --> Worker
    Worker -- "Status: PROCESSING -> SENT/FAILED" --> MySQL
    Worker -- "Rate Check & Delays" --> RedisDB
    Worker -- "Multi-Account Dispatch" --> EtherealSMTP
    Worker -- "Index Sent Document" --> ESIndex
    SlackNotifier -- "Post Completion Summary" --> SlackChannels
```

---

## Main Features

- **Google OAuth 2.0 & Redis Sessions**: Secure Google authentication with persistent server-side Redis sessions (`connect-redis`) and user-scoped data isolation.
- **CSV & TXT Recipient Parsing**: Client-side recipient parsing supporting comma, space, and newline delimiters, RFC 5322 regex validation, header skipping, and duplicate filtering.
- **Multi-Sender SMTP Orchestration**: Dynamic multi-account sending via Ethereal SMTP with public sender choices exposed without leaking private SMTP credentials.
- **BullMQ Queue Management**: Background job queuing storing only minimal `{ emailId }` payloads in Redis, with exponential backoff retries and concurrency control.
- **Distributed Rate Limiting & Live Slack Alerts**: Redis-backed sliding 1-hour window per tenant + sender with atomic Lua reservation, non-destructive BullMQ deferral, and live Slack Block Kit alerts on quota exhaustion.
- **MySQL Persistence via Prisma ORM**: Relational database modeling for users, campaigns, scheduled emails, and encrypted Slack installations with foreign keys and indexes.
- **Elasticsearch Full-Text Search**: Real-time indexing of both scheduled and sent emails across dedicated indices (`reachinbox-scheduled-emails` and `reachinbox-sent-emails`) with multi-match search queries, user ID scoping, and safe snippet highlighting.
- **Safe Snippet Highlighting**: Search match highlighting without `dangerouslySetInnerHTML` by parsing Elasticsearch `<em>` tokens into safe React elements.
- **Protected Bull Board Queue Monitor**: Interactive queue monitor mounted at `/admin/queues` guarded by Express session authentication.
- **Real Slack OAuth 2.0 Integration**: Single-use cryptographic CSRF state tokens and AES-256-GCM encryption for Slack bot access tokens at rest.
- **Idempotent Delivery Reports & Deduped Alerts**: Atomic MySQL status claims (`PENDING -> PROCESSING -> SENT`) for campaign summaries and Redis `SET NX` rate-limit alert deduplication with bounded TTL.
- **Responsive Dark-Theme Dashboard**: Glassmorphic UI with isolated global metric counters, independent full-text search across Scheduled and Sent tabs, in-place campaign scheduler modal, and search filters.

---

## Distributed Rate Limiting & Real-Time Slack Rate-Limit Alerts

To safeguard sender reputations and conform to upstream SMTP hourly thresholds, the system implements an enterprise-grade distributed rate controller and real-time alert engine.

```mermaid
sequenceDiagram
    autonumber
    participant Worker as BullMQ Worker
    participant Redis as Redis (Atomic Lua)
    participant MySQL as MySQL (Prisma)
    participant Slack as Slack API (Block Kit)
    participant SMTP as Ethereal SMTP

    Worker->>Redis: reserveDispatchSlot(userId, senderKey, hourlyLimit, delaySeconds)
    alt Slot Available (allowed = true)
        Redis-->>Worker: { allowed: true, waitMs: 0 }
        Worker->>MySQL: Lock status: PROCESSING
        Worker->>SMTP: sendEmail(senderKey, recipient, subject, body)
        Worker->>MySQL: Update status: SENT, sentAt: now()
    else Inter-Email Throttle (reason = MIN_DELAY)
        Redis-->>Worker: { allowed: false, waitMs: remainingMs, reason: MIN_DELAY }
        Worker->>MySQL: Update status: RATE_LIMITED, scheduledAt: deferredTime
        Worker->>Worker: job.moveToDelayed(deferredTime)
    else Hourly Limit Reached (reason = HOURLY_LIMIT)
        Redis-->>Worker: { allowed: false, waitMs: windowWaitMs, reason: HOURLY_LIMIT }
        Worker->>MySQL: Update status: RATE_LIMITED, scheduledAt: deferredTime
        Worker->>Redis: SET NX alert_key EX ttl
        opt First detection in window (SET NX acquired)
            Worker->>Slack: chat.postMessage (Block Kit Rate Limit Alert)
        end
        Worker->>Worker: job.moveToDelayed(deferredTime)
    end
```

### Key Architectural Tenets

1. **Multi-Tenant & Multi-Sender Scoping**:
   - Rate limiting is scoped by authenticated user/tenant ID + sender key (`reachinbox:ratelimit:window:user-{userId}:sender-{senderKey}` and `reachinbox:ratelimit:lastdispatch:user-{userId}:sender-{senderKey}`).
   - Campaign-configured hourly limits are shared and enforced globally across all campaigns sharing the same tenant and sender account to protect SMTP sender quotas.

2. **Atomic Redis / Lua Reservation Engine**:
   - A single-round-trip atomic Lua script evaluates both rolling 60-minute hourly limit capacity (`ZREMRANGEBYSCORE`, `ZCARD`) and inter-email delay spacing (`GET last_dispatch`).
   - If capacity is available, the dispatch timestamp is atomically recorded in the sorted set and `last_dispatch` key without concurrency race conditions across multi-worker deployments.

3. **MIN_DELAY vs. HOURLY_LIMIT Deferral Distinction**:
   - **`MIN_DELAY`**: Job is deferred by the remaining milliseconds until the per-sender minimum inter-email delay is satisfied. This represents routine dispatch pacing and does not trigger alerts.
   - **`HOURLY_LIMIT`**: Hourly quota has been exhausted. The job is deferred until the oldest rolling slot rolls out of the 60-minute window (calculated exactly via `ZRANGEBYSCORE`). This triggers a real-time Slack alert.

4. **Non-Destructive BullMQ Rescheduling**:
   - Rate-limited jobs are marked `RATE_LIMITED` in MySQL with their `scheduledAt` updated to the next eligible timestamp, and rescheduled using `job.moveToDelayed(nextEligibleTimestamp)`.
   - Rate-limited jobs are **never dropped**, **never marked as FAILED**, and **do not consume BullMQ retry attempt counters**.

5. **Live Slack API Alert on First Detection**:
   - On the first `HOURLY_LIMIT` detection, a live Slack API call (`chat.postMessage`) delivers an actionable Block Kit message to the designated channel.
   - The alert displays the friendly sender display name, hourly quota, campaign context, and the next eligible dispatch timestamp in UTC.

6. **Distributed Deduplication (`Redis SET NX`)**:
   - High-throughput bursts on a rate-limited sender are deduplicated via `reachinbox:ratelimit:alert:user-{userId}:sender-{senderKey}` with a bounded TTL matching the wait duration.
   - Prevents flooding Slack channels with duplicate alerts while automatically allowing notifications in subsequent hourly windows.

7. **Resilient Failure Handling & Dynamic Reconnection**:
   - If Slack is disconnected, the destination channel is missing, or the Slack API fails/times out, the notification is safely skipped/logged as a warning without throwing or interrupting email deferral.
   - Dynamic database lookup on every rate-limit hit ensures that when a user connects or reconnects Slack, notifications immediately work without server or worker redeployment.
   - The existing idempotent campaign-completion Slack notification remains fully available and operates independently.

8. **Safe Operational Logging**:
   - All worker logs use safe identifiers (e.g. sender keys `[sender-1]`, campaign IDs, sanitized error messages).
   - Sender SMTP email addresses, usernames, passwords, OAuth tokens, recipient addresses, and message bodies are never printed to application logs.

### Architectural Trade-offs

- **Tenant + Sender Scoping vs. Campaign Isolation**: Scoping to tenant + sender prevents exceeding external SMTP quotas across simultaneous campaigns from the same sender account, but means concurrent campaigns share the same hourly allowance.
- **Sliding Sorted Set (ZSET) vs. Fixed Window**: Redis sorted sets provide true rolling 60-minute window precision without boundary-reset spikes, at the cost of $O(\log N)$ memory proportional to the hourly quota per active sender.
- **Redis SET NX Alert Dedup vs. Notification Queue**: In-memory TTL keys provide low-latency, zero-storage alert suppression on the leading edge of a rate limit without maintaining persistent alert queues.

---

## Elasticsearch Full-Text Search Architecture & Lifecycle

The system provides production-grade full-text search across **both scheduled and sent emails** using dedicated Elasticsearch indices, ensuring high-speed keyword retrieval, safe snippet highlighting, and absolute tenant isolation.

### Dedicated Index Design & Mappings

- **Scheduled Emails Index (`reachinbox-scheduled-emails`)**:
  - Contains active scheduled emails awaiting or undergoing dispatch.
  - Fields: `id` (keyword), `userId` (keyword), `campaignId` (keyword), `senderKey` (keyword), `recipientEmail` (keyword + text subfield), `subject` (text), `body` (text), `status` (keyword), `scheduledAt` (date), `createdAt` (date).
- **Sent Emails Index (`reachinbox-sent-emails`)**:
  - Contains historical dispatched emails.
  - Fields: `id` (keyword), `userId` (keyword), `campaignId` (keyword), `senderKey` (keyword), `recipientEmail` (keyword + text subfield), `subject` (text), `body` (text), `status` (keyword), `scheduledAt` (date), `sentAt` (date), `smtpMessageId` (keyword), `etherealPreviewUrl` (keyword).

### Scheduled-Document Lifecycle & Invariants

```mermaid
stateDiagram-v2
    [*] --> SCHEDULED: Campaign Created (Bulk Indexed)
    SCHEDULED --> RATE_LIMITED: Hourly Limit Hit (ES Doc Updated)
    RATE_LIMITED --> SCHEDULED: Rescheduled (ES Doc Updated)
    SCHEDULED --> PROCESSING: Worker Claimed (ES Doc Updated)
    PROCESSING --> SENT: SMTP Success (Indexed in Sent Index & Removed from Scheduled Index)
    PROCESSING --> FAILED: Retries Exhausted (Indexed in Sent Index & Removed from Scheduled Index)
```

1. **Scheduled States**: Records in `SCHEDULED`, `RATE_LIMITED`, or `PROCESSING` states reside in `reachinbox-scheduled-emails`.
2. **Terminal Transition & Index Migration**: When an email reaches `SENT` or `FAILED`, it is indexed into `reachinbox-sent-emails` and automatically removed from `reachinbox-scheduled-emails` via `deleteScheduledEmailDoc`.
3. **Authoritative MySQL State**: MySQL remains the single source of truth. If a scheduled indexing operation encounters a terminal record, it skips indexing and ensures removal from the scheduled index to prevent state races.
4. **API & Worker Startup Separation**:
   - **API Startup**: Automatically runs idempotent index initialization (`ensureSentEmailsIndex`, `ensureScheduledEmailsIndex`) and safe reconciliation backfills (`backfillSentEmailsToIndex`, `backfillScheduledEmailsToIndex`).
   - **Worker Startup**: Idempotently ensures indices exist without performing redundant full backfills across scaled worker replicas. Incremental synchronization occurs during job execution.
5. **Non-Blocking Resilience**: Elasticsearch indexing operations are wrapped in safe try/catch handlers. Elasticsearch connection failures or timeouts are logged cleanly and never roll back successful MySQL transactions, crash the API, or drop background jobs.
6. **Tenant & Count Isolation**:
   - All search queries strictly filter by authenticated `userId = req.user.id`.
   - Global dashboard counters (`globalScheduledTotal` and `globalSentTotal`) remain constant and isolated when users perform keyword searches within either tab.

---

## Technology Stack

| Category | Technologies |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Lucide React Icons |
| **Backend** | Node.js (v20+ / v24+), Express.js, TypeScript, TSX, Zod, Passport.js, Express-Session, Connect-Redis, Nodemailer |
| **Databases & ORM** | MySQL 8.0, Prisma ORM (`@prisma/client`), Redis 7.0 (`ioredis`, `redis`), Elasticsearch 8.15 (`@elastic/elasticsearch`) |
| **Queue & Monitoring**| BullMQ 6.x, Bull Board (`@bull-board/express`, `@bull-board/api`) |
| **Integrations** | Google OAuth 2.0, Slack Web API (OAuth v2, Block Kit), Ethereal Email SMTP |
| **Security & Crypto** | Node.js `crypto` (AES-256-GCM with 12-byte IV and 16-byte Auth Tag), CSRF State Tokens |
| **Testing** | Vitest 5.x, React Testing Library, Isolated Mocking & Fixtures |

---

## Prerequisites & Port Allocations

Ensure the following tools are installed on your host machine:

- **Node.js**: `v20.x` or `v24.x` (LTS recommended)
- **npm**: `v10.x` or higher
- **Docker & Docker Compose**: Docker Desktop 4.x+

### Port Allocations

| Service | Port | Description |
| :--- | :--- | :--- |
| **Frontend Client** | `5173` | Vite development server (`http://localhost:5173`) |
| **Backend API** | `5000` | Express REST API server (`http://localhost:5000`) |
| **MySQL Database** | `3307` | Host forwarded port for Docker MySQL 8.0 container |
| **Redis Server** | `6379` | Docker Redis 7.0 container for BullMQ and sessions |
| **Elasticsearch** | `9200` | Docker Elasticsearch 8.15 container for sent and scheduled email indices |

---

## Installation & Setup

### 1. Clone & Install Dependencies

Clone the repository and install all monorepo dependencies:

```powershell
# Navigate to project directory
cd C:\Users\Suprita\Documents\Projects\reachinbox-email-scheduler

# Install root, backend, and frontend packages via npm workspaces
npm install
```

---

### 2. Configure Environment Variables

Create the `.env` file for the backend and frontend using the provided templates:

#### Backend Configuration (`backend/.env`)

```powershell
# Copy the example file
Copy-Item backend\.env.example backend\.env
```

Populate `backend/.env` with your credentials:

```ini
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
CLIENT_URL=http://localhost:5173

# MySQL 8 Database (mapped to port 3307 on host)
DATABASE_URL="mysql://reachinbox_user:reachinbox_password@localhost:3307/reachinbox_scheduler"

# Redis (BullMQ & Session Storage)
REDIS_URL="redis://localhost:6379"

# Elasticsearch
ELASTICSEARCH_URL="http://localhost:9200"

# Express Session Secret
SESSION_SECRET="your_secure_random_session_secret_32_chars"

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID="your_google_client_id_here.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your_google_client_secret_here"
GOOGLE_CALLBACK_URL="http://localhost:5000/api/auth/google/callback"

# Slack OAuth 2.0 Integration & Token Encryption
# Required bot scopes: chat:write, channels:read, groups:read
SLACK_CLIENT_ID="your_slack_client_id_here"
SLACK_CLIENT_SECRET="your_slack_client_secret_here"
SLACK_REDIRECT_URI="http://localhost:5000/api/slack/oauth/callback"
# 32-byte / 64-hex AES-256-GCM encryption key (e.g., openssl rand -hex 32)
SLACK_TOKEN_ENCRYPTION_KEY="your_64_hex_character_encryption_key_here"

# BullMQ Worker Concurrency (default 5)
WORKER_CONCURRENCY=5

# Ethereal SMTP Senders Configuration (JSON array of test accounts)
ETHEREAL_SENDERS_JSON='[{"key":"sender-1","displayName":"ReachInbox Sales","fromEmail":"your_ethereal_user_1@ethereal.email","host":"smtp.ethereal.email","port":587,"user":"your_ethereal_user_1@ethereal.email","pass":"your_ethereal_pass_1","secure":false},{"key":"sender-2","displayName":"ReachInbox Marketing","fromEmail":"your_ethereal_user_2@ethereal.email","host":"smtp.ethereal.email","port":587,"user":"your_ethereal_user_2@ethereal.email","pass":"your_ethereal_pass_2","secure":false}]'
```

#### Frontend Configuration (`frontend/.env`)

```powershell
# Copy the example file
Copy-Item frontend\.env.example frontend\.env
```

```ini
VITE_API_URL=http://localhost:5000/api
```

---

### 3. Start Docker Infrastructure

Start MySQL, Redis, and Elasticsearch containers in background daemon mode:

```powershell
npm run docker:up
```

Verify container health status:

```powershell
docker compose ps
```

*Expected output*: `reachinbox-mysql`, `reachinbox-redis`, and `reachinbox-elasticsearch` all in `healthy` status.

---

### 4. Database Setup & Prisma Client Generation

Generate the Prisma Client and apply database migrations safely:

```powershell
# Generate Prisma Client
npm --prefix backend run prisma:generate

# Synchronize database schema non-destructively
npx --prefix backend prisma db push
```

---

## Running the Application

You can launch all services concurrently or in dedicated PowerShell terminals:

### Option A: Run Concurrently (Single Command)

```powershell
npm run dev
```

### Option B: Run in Separate Terminals (Recommended for Inspection)

#### Terminal 1: Backend API Server
```powershell
npm run dev:backend
```
*API running at `http://localhost:5000`*

#### Terminal 2: BullMQ Background Worker
```powershell
npm run dev:worker
```
*Worker active with 5 concurrent dispatchers, connected to Redis*

#### Terminal 3: Frontend Client
```powershell
npm run dev:frontend
```
*Frontend running at `http://localhost:5173`*

---

## Application URLs

| Interface | URL | Description |
| :--- | :--- | :--- |
| **Frontend Dashboard** | [http://localhost:5173](http://localhost:5173) | Main user interface, campaign composer, sent email search |
| **Backend Health Check** | [http://localhost:5000/api/health](http://localhost:5000/api/health) | API health check and uptime metrics |
| **Bull Board Queue Monitor** | [http://localhost:5000/admin/queues](http://localhost:5000/admin/queues) | Real-time queue visualizer for BullMQ (Authenticated) |

---

## Slack App Configuration

To enable automated campaign completion notifications in Slack:

1. **Create Slack App**:
   - Go to the [Slack API Portal](https://api.slack.com/apps) and click **Create New App** > **From scratch**.
   - Set the App Name (e.g. `ReachInbox Email Scheduler`) and select your development workspace.

2. **Configure OAuth Redirect URL**:
   - Navigate to **OAuth & Permissions** in the sidebar.
   - Under **Redirect URLs**, add:
     `http://localhost:5000/api/slack/oauth/callback`
   - Click **Save URLs**.

3. **Add Bot Token Scopes**:
   - Under **Scopes** > **Bot Token Scopes**, add the following three permissions:
     - `chat:write` — To post completion delivery summaries.
     - `channels:read` — To list and verify public workspace channels.
     - `groups:read` — To list and verify private channels the bot is invited to.

4. **Retrieve Credentials**:
   - Navigate to **Basic Information** > **App Credentials**.
   - Copy **Client ID** and **Client Secret** into your `backend/.env`.
   - Generate a 32-byte (64 hex character) encryption key (e.g., via `openssl rand -hex 32`) and assign to `SLACK_TOKEN_ENCRYPTION_KEY`.

5. **Channel Access in Slack**:
   - For private channels, invite the bot by typing `/invite @ReachInbox Email Scheduler` in the channel.

---

## End-to-End Walkthrough

1. **Sign In**: Navigate to `http://localhost:5173` and click **Sign in with Google**.
2. **Connect Slack (Optional)**: Click the **Connect Slack** badge in the header. Authorize the application on Slack's OAuth consent screen; upon redirection, your connected workspace name will appear.
3. **Compose Campaign**:
   - Click **Compose Campaign**.
   - Select an authenticated sender account.
   - Enter the email subject and body.
   - Upload a `.csv` or `.txt` file containing recipient email addresses.
   - Set the dispatch start time, delay between messages (e.g., `5` seconds), and hourly limit (e.g., `100` emails/hr).
   - If Slack is connected, check **Notify Slack when campaign completes** and select the destination channel.
   - Click **Schedule Campaign**.
4. **Queue Processing & Rate Limiting**:
   - BullMQ picks up jobs at the scheduled start time.
   - Redis enforces the sliding 1-hour quota and inter-email delays.
   - View active, completed, and delayed jobs in real-time on Bull Board at `http://localhost:5000/admin/queues`.
5. **Sent Email Search & Highlights**:
   - Once emails are sent, inspect the **Sent Emails** tab on the dashboard.
   - Use the search bar to query by keyword; matching text will be safely highlighted.
6. **Slack Delivery Notification**:
   - As soon as all emails in the campaign reach a terminal status (`SENT` or `FAILED`), an idempotent Block Kit delivery report is posted to your chosen Slack channel.

---

## API Reference

All endpoints (except `/api/health` and `/api/auth/google*`) require an active session cookie (`credentials: 'include'`).

### Authentication
- `GET /api/auth/google` — Initiates Google OAuth 2.0 flow.
- `GET /api/auth/google/callback` — Google OAuth callback.
- `GET /api/auth/status` — Returns current authenticated user profile.
- `POST /api/auth/logout` — Destroys current session and logs out.

### Email & Campaigns
- `GET /api/senders` — Returns public sender choices (`key`, `displayName`, `fromEmail`).
- `POST /api/campaigns` — Schedules a new email campaign.
- `GET /api/emails/scheduled?page=1&limit=10` — Paginated scheduled emails.
- `GET /api/emails/scheduled/search?q=keyword&page=1&limit=10` — Elasticsearch scheduled email search.
- `GET /api/emails/sent?page=1&limit=10` — Paginated sent email history.
- `GET /api/emails/search?q=keyword&page=1&limit=10` — Elasticsearch sent email search.

### Slack Integration
- `GET /api/slack/status` — Returns Slack connection status and workspace name.
- `GET /api/slack/oauth/start` — Initiates Slack OAuth 2.0 authorization.
- `GET /api/slack/oauth/callback` — Slack OAuth callback with CSRF state verification.
- `GET /api/slack/channels` — Fetches accessible workspace channels (`id`, `name`, `isPrivate`).
- `POST /api/slack/disconnect` — Disconnects Slack workspace and clears stored tokens.

### Health & Monitoring
- `GET /api/health` — Returns system uptime and service status.
- `GET /admin/queues` — Authenticated Bull Board dashboard.

---

## Security Architecture

1. **AES-256-GCM Token Encryption**:
   - Slack bot tokens are encrypted at rest in MySQL using authenticated AES-256-GCM.
   - Format: `ivHex:authTagHex:ciphertextHex`.
   - Tokens are decrypted in memory only immediately before posting and are never logged or returned via API responses.

2. **Single-Use CSRF State Protection**:
   - OAuth state parameters are generated as 32-byte cryptographic random hex strings and stored in the user session.
   - State tokens are deleted immediately upon validation during callback handling.

3. **User-Scoped Data Isolation**:
   - All campaigns, scheduled emails, Elasticsearch search queries, and Slack installations are partitioned strictly by `userId = req.user.id`.

4. **Minimal Queue Payload**:
   - BullMQ jobs contain only `{ emailId: string }`.
   - Private email bodies, recipient addresses, and SMTP credentials are never serialized into Redis queue data.

5. **XSS-Safe Highlighting**:
   - Search snippet rendering parses Elasticsearch `<em>` tags directly into React virtual DOM elements (`<mark>`) without using `dangerouslySetInnerHTML`.

6. **Error Sanitization**:
   - Upstream SMTP and network errors are sanitized to prevent credential leakage in logs and API error responses.

---

## Testing & Quality Assurance

The codebase includes an isolated, deterministic test suite covering unit calculations, scheduling rules, rate limiters, token cryptography, OAuth flows, and highlighting helpers.

### Run All Tests
```powershell
npm test
```

### Run Type Checking
```powershell
npm run typecheck
```

### Run Production Build
```powershell
npm run build
```

### Verified Test Results
```text
✓ backend (97 tests passed)
  - slack.test.ts (35 tests)
  - scheduler.test.ts (45 tests)
  - rateLimiter.test.ts (17 tests)

✓ frontend (24 tests passed)
  - recipientParser.test.ts (18 tests)
  - highlightHelper.test.ts (6 tests)

Total: 121/121 tests passed (100% pass rate)
Typecheck: 0 errors
Production Build: Successful
```

---

## Project Structure

```
reachinbox-email-scheduler/
├── docker-compose.yml              # MySQL 8, Redis 7, Elasticsearch 8 services
├── package.json                    # Workspace scripts & dev dependencies
├── README.md                       # Comprehensive documentation
├── .gitignore                      # Git exclusion rules
├── backend/                        # Express API & Worker codebase
│   ├── .env.example                # Backend environment template
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma           # Prisma MySQL schema
│   └── src/
│       ├── config/                 # Env, Redis, Prisma, Passport, Bull Board
│       ├── controllers/            # Route controllers (Auth, Email, Campaign, Slack)
│       ├── middleware/             # requireAuth, error sanitization
│       ├── routes/                 # Express route definitions
│       ├── services/               # Core services (Scheduler, Slack, RateLimiter, ES)
│       ├── validators/             # Zod schema validators
│       ├── app.ts                  # Express application factory
│       ├── index.ts                # HTTP Server entry point (Port 5000)
│       └── worker.ts               # BullMQ Worker entry point
└── frontend/                       # React 18 + Vite frontend
    ├── .env.example                # Frontend environment template
    ├── index.html
    ├── package.json
    ├── tailwind.config.js
    ├── vite.config.ts
    └── src/
        ├── components/             # ComposeModal, Dashboard widgets
        ├── utils/                  # Recipient parser, highlight helper
        ├── App.tsx                 # Main application dashboard
        └── main.tsx                # React root entry point
```

---

## Troubleshooting

| Problem | Cause | Solution |
| :--- | :--- | :--- |
| **Port 5000 already in use** | An existing node process is bound to port 5000. | Run `Get-Process node \| Stop-Process` in PowerShell or change `PORT=5001` in `backend/.env`. |
| **MySQL / Redis / ES Unavailable** | Docker containers are not running. | Run `npm run docker:up` and check `docker compose ps` to verify all three services are healthy. |
| **Invalid ETHEREAL_SENDERS_JSON** | JSON parsing failed in `backend/.env`. | Ensure `ETHEREAL_SENDERS_JSON` is wrapped in single quotes and contains valid JSON array syntax. |
| **Slack Encryption Key Error** | `SLACK_TOKEN_ENCRYPTION_KEY` is not 32 bytes (64 hex characters). | Generate a valid 64-hex key: `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` and update `backend/.env`. |
| **Slack Channel Fetch Failed** | Network timeout or bot missing permissions. | Re-open the modal or click **Retry fetching channels**. Ensure bot token scopes include `channels:read` and `groups:read`. |
| **Bot Cannot Post to Private Channel** | Bot was not invited to the private channel. | In the private Slack channel, type `/invite @<YourBotName>` to grant access. |

---

## Demo Checklist

Ensure the following features are showcased during demonstration:

1. [ ] **Sign in with Google**: Authenticate on the dashboard.
2. [ ] **Connect Slack Workspace**: Authorize the Slack app via OAuth and view the connected badge.
3. [ ] **Recipient Parsing**: Upload a sample CSV with valid, invalid, and duplicate emails to verify validation.
4. [ ] **Campaign Dispatch**: Schedule a campaign with a 5-second delay and Slack notification enabled.
5. [ ] **Bull Board Monitoring**: Observe active jobs in `http://localhost:5000/admin/queues`.
6. [ ] **Sent Email Search**: Search sent emails with highlighted keywords.
7. [ ] **Slack Delivery Report**: Verify Block Kit completion summary posted in Slack.
8. [ ] **Slack Rate-Limit Alert**: Verify Block Kit rate-limit alert posted on sender hourly limit exhaustion.

---

## Application Screenshots

### 1. Operations Dashboard
The central dashboard displays real-time metrics for scheduled and delivered emails, active sender accounts, Slack workspace connectivity, and email campaign history.

![ReachInbox Operations Dashboard](docs/screenshots/02-dashboard.png)

---

### 2. Google OAuth 2.0 Login
Clean and secure login interface with Google OAuth 2.0 authentication and session state preservation.

![ReachInbox Google OAuth 2.0 Login Screen](docs/screenshots/01-login.png)

---

### 3. Campaign Compose & Recipient Ingestion
Modal interface for configuring multi-sender campaigns, composing subject and body content, and parsing CSV/TXT recipient lists with client-side validation.

![Campaign Compose Modal Top Section](docs/screenshots/03-compose-modal-top.png)

---

### 4. Dispatch Timing & Slack Integration
Campaign scheduling options including inter-email delay intervals, sliding-window hourly rate limits, and automated Slack completion notification channel selection.

![Campaign Dispatch Timing and Slack Integration](docs/screenshots/04-compose-modal-slack.png)

---

### 5. Elasticsearch Highlighted Search
Full-text search interface querying Elasticsearch for sent email subjects and bodies with safe client-side match snippet highlighting.

![Elasticsearch Sent Email Search Results](docs/screenshots/05-search-results.png)

---

### 6. Bull Board Queue Monitoring
Authenticated real-time queue visualizer displaying active, delayed, waiting, and completed BullMQ background dispatch jobs.

![Bull Board Queue Monitoring Dashboard](docs/screenshots/06-queue-monitor.png)

---

### 7. Slack Completion Notification
Automated Block Kit delivery summary posted to the designated Slack channel upon campaign completion with status breakdown.

![Slack Automated Campaign Completion Notification](docs/screenshots/07-slack-notification.png)

---

### 8. Mobile Responsive Dashboard
Optimized mobile interface (tested at 390px viewport) with responsive metric badges, compact tab navigation, and touch-friendly controls.

![ReachInbox Mobile Responsive Dashboard](docs/screenshots/08-mobile-dashboard.png)

---

### 9. Real-Time Slack Rate-Limit Alert
Live Slack Block Kit notification triggered when a sender reaches their configured hourly dispatch limit, displaying the sender display name, hourly quota, campaign context, and the next eligible dispatch time.

![Slack Hourly Rate Limit Reached Notification](docs/screenshots/09-slack-rate-limit-alert.png)

---

### 10. BullMQ Delayed Rate-Limited Job
Bull Board queue visualizer showing completed jobs and delayed jobs gracefully rescheduled by the background worker without job loss or failure count incrementation.

![Bull Board Delayed Rate-Limited Job](docs/screenshots/10-rate-limited-job-delayed.png)

---

## Author

**Suprita Biradar**
*ReachInbox Software Development Intern Assignment*
