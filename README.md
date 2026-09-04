# ReachInbox Email Scheduler

A scalable background email scheduling and dispatching application built for the ReachInbox Software Development Intern assignment.

## Phase 1 Architecture & Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite, Lucide Icons
- **Backend**: Express.js, TypeScript, Prisma ORM
- **Database**: MySQL 8.0 on port 3307 (Docker)
- **Queuing & Cache**: Redis 7 on port 6379 (Docker) & BullMQ (configured for subsequent phases)
- **Search Engine**: Elasticsearch 8.15 on port 9200 (Docker)
- **Infrastructure**: Docker Compose with health checks and persistent volumes

---

## Project Structure

```
reachinbox-email-scheduler/
├── docker-compose.yml          # Infrastructure services (MySQL 8, Redis 7, Elasticsearch 8)
├── package.json                # Monorepo root workspace configuration
├── .gitignore                  # Git ignore rules
├── .env.example                # Root environment template
├── backend/                    # Express.js + TypeScript + Prisma backend
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma       # Prisma ORM schema for MySQL
│   └── src/
│       ├── config/env.ts       # Type-safe environment configuration
│       ├── controllers/        # Route controllers
│       ├── routes/             # Express API routes
│       ├── app.ts              # Express application factory
│       ├── index.ts            # Server entrypoint (Port 5000)
│       └── worker.ts           # Background worker process entrypoint
└── frontend/                   # React + TypeScript + Vite + Tailwind CSS frontend
    ├── .env.example
    ├── index.html
    ├── package.json
    ├── postcss.config.js
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx             # Phase 1 Health Dashboard
        ├── index.css           # Tailwind design tokens
        └── main.tsx            # React root mount
```

---

## Getting Started (Phase 1 Setup)

### Prerequisites

- Node.js (v20+ or v24+)
- Docker & Docker Compose
- npm (v10+)

### 1. Start Infrastructure Services

Start MySQL 8, Redis 7, and Elasticsearch 8 in the background:

```bash
npm run docker:up
```

Verify the health status of all containers:

```bash
docker compose ps
```

### 2. Install Dependencies

Install root, backend, and frontend dependencies via npm workspaces:

```bash
npm install
```

### 3. Generate Prisma Client

Generate the Prisma client for MySQL:

```bash
npm --prefix backend run prisma:generate
```

### 4. Run Type Checks

Verify TypeScript compilation across the entire monorepo:

```bash
npm run typecheck
```

### 5. Start Development Servers

Run both the backend API and frontend client concurrently:

```bash
npm run dev
```

Or run them individually in separate terminals:

```bash
# Terminal 1: Backend API (http://localhost:5000)
npm run dev:backend

# Terminal 2: Frontend Client (http://localhost:5173)
npm run dev:frontend
```

---

## Verification & Health Check

The backend exposes a health endpoint:
- **Health Check URL**: `http://localhost:5000/api/health`
- **Expected Response**:
  ```json
  {
    "status": "ok",
    "service": "reachinbox-email-scheduler-backend",
    "phase": 1,
    "environment": "development",
    "uptimeSeconds": 10,
    "timestamp": "2026-09-03T17:24:00.000Z"
  }
  ```

---

## Available NPM Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Runs backend and frontend concurrently |
| `npm run dev:backend` | Starts the Express backend in watch mode |
| `npm run dev:frontend` | Starts the Vite frontend dev server |
| `npm run dev:worker` | Starts the background worker entry point |
| `npm run typecheck` | Runs TypeScript typecheck on both backend and frontend |
| `npm run build` | Builds both backend and frontend for production |
| `npm run docker:up` | Starts MySQL, Redis, and Elasticsearch containers |
| `npm run docker:down` | Stops and removes containers |
| `npm run docker:logs` | Streams logs from all Docker containers |
