# Arenaze — Gaming-Café Operator Console (Phase 1)

A full-stack **operator dashboard** that gaming-café staff run the floor on: live device
monitoring, walk-ins, slot-availability search, bookings, a booking ledger, pricing,
customers, and analytics — backed by a real Postgres server that owns billing/availability
state and is **safe against double-booking and restarts**.

The UI is the imported **GameGrid Operator** design, rebranded to **Arenaze**. The backend
implements the **CafeHub Phase 1 PRD v2** spec. See [`PLAN.md`](./PLAN.md) for the full
design rationale and [`BUILD_CONTRACT.md`](./BUILD_CONTRACT.md) for the API contract.

---

## Quick start

Prerequisites: **Node ≥ 20**, **Docker** (for Postgres). No local Postgres needed.

```bash
cd arenaze
cp .env.example .env          # defaults work out of the box for local dev
docker compose up -d          # Postgres 16 on host port 5433
npm install                   # installs all workspaces
npm run db:migrate            # create schema (+ btree_gist exclusion constraint)
npm run db:seed               # seed café, users, 24 devices, live floor, bookings
npm run dev                   # server :4000 + web :5173 together
```

Then open **http://localhost:5173** and log in:

| Role  | Username | Password   | Sees |
|-------|----------|------------|------|
| Admin | `admin`  | `admin123` | Everything (incl. Analytics + Pricing) |
| Staff | `staff`  | `staff123` | Floor, Availability, Ledger, Customers |

> If `npm install` fails with `EACCES` on `~/.npm`, your npm cache has root-owned files
> (a known npm bug). Use a local cache: `npm install --cache /tmp/arenaze-npm-cache`.

Reset the demo data anytime with `npm run db:reset` (drops, re-migrates, re-seeds).

---

## Architecture

```
arenaze/
├─ shared/   @arenaze/shared — types both sides import (API contract, money/paise, roles)
├─ db/       @arenaze/db     — SQL migrations + migration runner + seed
├─ server/   @arenaze/server — Fastify API (auth, middleware, routes)
└─ web/      @arenaze/web    — Vite + React + TS operator UI (ported design)
```

One **npm workspaces** monorepo: a single `npm install` and a couple of scripts run everything.
`shared/` is consumed as TypeScript source by both `tsx` (server) and Vite (web), so there is
no build step for the contract — the type that the server returns is the type the web expects.

**Stack:** Vite + React 18 + TypeScript · React Router · TanStack Query (10s snapshot poll +
forced refetch after mutation) · bespoke CSS ported from the design · Fastify 5 · `pg` with
hand-written SQL · Zod validation · Argon2id + JWT (access + rotating refresh) · PostgreSQL 16
with `btree_gist`.

### Data model (all money in integer **paise**, every row carries `tenant_id`)

`tenants · users · refresh_tokens · devices · customers · pricing_rules · bookings ·
booking_devices · sessions · transactions · audit_log`

The load-bearing safety property lives in the database, not the app:

```sql
-- booking_devices: overlapping live slots on the same device are physically impossible
CONSTRAINT no_double_book EXCLUDE USING gist (device_id WITH =, slot WITH &&)
  WHERE (status IN ('upcoming','active'));   -- cancelled/completed free the slot
```

Accrued bills are **derived on read** (`elapsed × rate ÷ 3600`, integer paise) and finalized to
a `transactions` row on checkout — so a restart never loses an active session or its running tab.

---

## API surface

Base `http://localhost:4000/api`. `Authorization: Bearer <accessToken>`; `tenant_id` is taken
from the token, never the client. Full request/response types live in
[`shared/src/api.ts`](./shared/src/api.ts); the endpoint table is in
[`BUILD_CONTRACT.md`](./BUILD_CONTRACT.md).

- **Auth** — `POST /auth/login | /refresh | /logout | /forgot-password`
- **Devices / Floor** — `GET /devices` (full snapshot, 10s poll) · `POST /devices/:id/start | /end-session | /extend` · `PATCH /devices/:id` · `POST /devices`
- **Dashboard** — `GET /dashboard/tiles`
- **Availability** — `POST /availability/search` (matches + nearest-slot fallback)
- **Bookings** — `POST /bookings` (Idempotency-Key + serializable txn → 201 or **409 slot_taken**) · `/:id/start | /extend | /cancel` · `GET /bookings` (ledger)
- **Customers** — `GET /customers?q` · `GET /customers/:id`
- **Pricing** *(admin)* — `GET /pricing` · `PATCH /pricing/:id`
- **Analytics** *(admin)* — `GET /analytics/overview`

---

## PRD correctness guarantees honored

1. Postgres **exclusion constraint** → double-booking impossible (holds across app instances).
2. **Serializable transaction** on booking create with re-validation → the loser gets `409 slot_taken`.
3. **Idempotency-Key** on create → a retried POST returns the original booking, never a second one.
4. Money is **integer paise** end-to-end (never floats).
5. **Argon2id** password hashing; **JWT** access (15m) + **refresh** (hashed, rotated, revocable).
6. **Multi-tenancy** — `tenant_id` always from the token.
7. **Accrued bill derived on read**, finalized on end; **survives restart**.
8. State machines + role checks enforced **server-side**, not just hidden in the UI.
9. **`audit_log`** on every mutation; **full-snapshot** polling self-heals a missed poll.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (:4000) + web (:5173) together |
| `npm run dev:server` / `npm run dev:web` | run one side |
| `npm run db:migrate` / `db:seed` / `db:reset` | database lifecycle |
| `npm run typecheck` | typecheck all workspaces |
| `npm run build` | production build of the web app |

---

## Notes & deliberate decisions

- **CSS over Tailwind** — the design ships a polished bespoke CSS-variable system; it's ported
  verbatim for pixel fidelity. (Only deviation from the PRD's suggested FE stack.)
- **Node/Fastify** backend — the PRD leaves backend language to the team; Node keeps one toolchain.
- **Postgres via Docker** on host port **5433** (avoids clashing with any local Postgres).
- Demo café is **"Nexus LAN, Andheri West"** — a *customer* of Arenaze; the product chrome is Arenaze.
- Default theme **maroon**; a dev tweaks panel (theme/typeface/density) is retained.
- Out of scope (PRD Phase 2+): consumer marketplace, payment gateway, hardware lock.
