# Arenaze — Phase 1 Management System · Implementation Plan

> Full-stack operator dashboard for a gaming café. Front-end is the imported
> **GameGrid Operator** design, rebranded to **Arenaze** and extended to the full
> page set. Backend implements the **CafeHub Phase 1 PRD v2** spec (Postgres,
> REST, JWT, double-booking safety). Strategy follows the competitor analysis:
> **operator SaaS first** — own the supply, be the system-of-record.

---

## 1. What we're building

A single-café (multi-tenant-ready) operator console that staff/admins run the floor on:
live device monitoring, walk-ins, slot-availability search, bookings, a booking ledger,
pricing, customers, and analytics — all backed by a real persistent server that owns
billing/availability state and is safe against double-booking and restarts.

---

## 2. Stack & rationale

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | Vite + React 18 + **TypeScript** | PRD endorses React+Vite; TS for the typed API contract |
| Routing | React Router | role-gated multi-page app (Login + dashboard sections) |
| Server state | **TanStack Query** | implements the PRD's polling contract (10s snapshot poll + forced refetch after mutation) cleanly |
| Styling | **The design's bespoke CSS, ported verbatim** (CSS-variable token system) | preserves the exact look; see deviation note §10 |
| **Backend** | Node + **TypeScript** + **Fastify** | one language across the stack, fast to build, satisfies every PRD requirement |
| DB access | **`pg` (node-postgres) + hand-written SQL migrations** | full control over the exclusion constraint, serializable txns, partial indexes — things ORMs hide |
| Validation | **Zod** | request shape validation → clean 400s, shared inferred types |
| Auth | **Argon2id** (`@node-rs/argon2`) + **JWT** (access+refresh) | exactly per PRD §9 |
| **Database** | **PostgreSQL 16** + `btree_gist`, via **Docker Compose** | exclusion constraint needs Postgres; Docker = zero local install |

**One toolchain:** `npm` workspaces tie `web/` + `server/` + `shared/` together so a single
`npm install` and a couple of scripts run everything.

---

## 3. Repository layout (under `arenaze/`)

```
arenaze/
├─ README.md                  # run instructions, architecture, spec coverage
├─ PLAN.md                    # this file
├─ docker-compose.yml         # postgres 16 + btree_gist
├─ .env.example               # DB url, JWT secrets, ports
├─ package.json               # npm workspaces root + top-level scripts
├─ shared/                    # types both sides import (API contract, enums, money helpers)
│   └─ src/{api.ts, money.ts, roles.ts}
├─ db/
│   ├─ migrations/            # 0001_init.sql … (tables, btree_gist, exclusion constraint, indexes)
│   └─ seed.ts                # ports gg-data.js → real rows (café, users, 24 devices, pricing, customers, live bookings)
├─ server/                    # Fastify API
│   └─ src/
│      ├─ index.ts            # bootstrap, run migrations on boot
│      ├─ db.ts               # pg pool + tx helpers (withSerializable)
│      ├─ config.ts, env.ts
│      ├─ auth/               # argon2, jwt, refresh-token store, middleware (authn + role)
│      ├─ middleware/         # tenant context, error envelope, audit
│      └─ routes/             # auth, devices, availability, bookings, ledger, dashboard, customers, pricing, transactions
└─ web/                       # Vite React app
    └─ src/
       ├─ main.tsx, App.tsx, router.tsx
       ├─ styles/tokens.css   # ported design system (themes, fonts, .cut, components)
       ├─ api/                # typed client, auth interceptor + silent token refresh, query hooks
       ├─ auth/               # auth context, ProtectedRoute, role gating
       ├─ components/         # Sidebar, Topbar, Pill, Metric, Drawer, Modal, Toast, TweaksPanel
       └─ views/              # Login, Floor, Availability, Ledger, Analytics, Customers, Pricing
```

---

## 4. Data model (PRD §6 — all money in **paise**, every row carries `tenant_id`)

`tenants · users · devices · customers · bookings · booking_devices · sessions ·
transactions · pricing_rules · audit_log`

**Load-bearing constraint (no double-booking):** `booking_devices` carries the slot
`tstzrange(start_at, end_at)` and a partial exclusion constraint rejects overlaps for
live/upcoming bookings:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE booking_devices ADD CONSTRAINT no_double_book
  EXCLUDE USING gist (device_id WITH =, slot WITH &&)
  WHERE (status IN ('upcoming','active'));   -- cancelled/completed don't block
```

**Derived, not stored:** accrued bill = `elapsed_seconds × rate ÷ 3600`, computed on read,
finalized to a ledger entry on session end. No financial state lives only in memory; a restart
never loses an active session or accrued bill.

---

## 5. API surface (PRD §7) — `Authorization: Bearer`, `tenant_id` from token, money in minor units

- **Auth** — `POST /api/auth/login | /refresh | /logout | /forgot-password`
- **Devices (Epic A)** — `GET /api/devices` (full floor snapshot, poll target) · `POST /api/devices/{id}/end-session` · `PATCH /api/devices/{id}` (status, admin) · device CRUD
- **Availability (Epic B)** — `POST /api/availability/search` → matches + **nearest-slot fallback** when empty
- **Bookings (Epic C)** — `POST /api/bookings` (**Idempotency-Key** + **serializable txn** → 201 or **409 "slot just taken"**) · `/start` · `/extend` · `/cancel`
- **Ledger (Epic D)** — `GET /api/bookings?from&to&status`
- **Dashboard** — `GET /api/dashboard/tiles` (occupancy, active slots, reserved, revenue today)
- **Customers** — `GET /api/customers?q` · `GET /api/customers/{id}`
- **Pricing** — `pricing_rules` CRUD (admin only)

State machines enforced **server-side**; invalid transitions → **409**. Every mutation writes `audit_log`.

---

## 6. Screens — design × PRD × doc, with role gating

| Screen | From design? | Adds (from PRD/doc) | Roles |
|---|---|---|---|
| **Login** | new | username/password, forgot-password, role-scoped redirect | public |
| **Floor / Device Monitor** | ✅ Floor view | grouped by device type, live countdown, accrued ₹, end-session, walk-in, maintenance | admin + staff |
| **Check Availability** | new (modal+results) | type/guests/in-time/duration/extendable → matches or nearest-slot; "available till" for extendable | admin + staff |
| **Book Now** | walk-in modal → extended | customer capture, re-validate on confirm, idempotent create | admin + staff |
| **Booking Ledger** | ✅ Reservations | date filter, multi-device rows, total ₹, cancel | admin + staff |
| **Analytics** | ✅ Analytics | util-by-hour + revenue charts from real data | **admin only** |
| **Customers** | ✅ Members | CRM seeded from bookings, visit/spend history | admin + staff |
| **Pricing** | new | per-device-type hourly rates | **admin only** |

Side-nav rebranded **Arenaze**; nav items role-gated (Pricing/Analytics hidden + 403-guarded for staff).

---

## 7. PRD correctness guarantees honored

1. Postgres **exclusion constraint** → double-booking impossible (holds across app instances).
2. **Serializable transaction** on booking create with re-validation → loser gets 409.
3. **Idempotency-Key** on create → retried POST never double-books.
4. Money = **integer paise** end-to-end (never floats).
5. **Argon2id** hashing; **JWT** access (15m) + **refresh** (hashed, rotated, revocable).
6. **Multi-tenancy** — `tenant_id` always from the token, never trusted from client.
7. **Accrued bill derived on read**, finalized on end; **survives restart**.
8. State machines + role checks enforced on the **backend**, not just hidden in UI.
9. **audit_log** on every mutation; **full-snapshot** polling self-heals a missed poll.

---

## 8. Build phases (execution order after approval)

- **P0 — Scaffold:** workspaces, docker-compose (PG+btree_gist), `.env`, web+server+shared skeletons, README stub.
- **P1 — Database:** migrations for all 10 tables + exclusion constraint + indexes; migration runner; `seed.ts` (port gg-data.js → Arenaze café, admin/staff users, 24 devices, pricing, customers, live bookings/sessions).
- **P2 — Backend core:** pg pool + tx helpers, env/config, Argon2id+JWT, refresh-token store, authn + tenant + role middleware, error envelope, audit helper.
- **P3 — Backend routes:** all endpoints in §5, Zod validation, state machines, idempotency, serializable booking create, nearest-slot fallback.
- **P4 — Frontend foundation:** port design CSS tokens, Vite/TS/Router/Query, typed API client + silent refresh, app shell (sidebar/topbar) rebranded, theme tweaks panel, auth context + ProtectedRoute.
- **P5 — Frontend screens:** Login → Floor (port `gg-app.jsx`, wire to API, 10s poll, drawer, walk-in, end/extend/maintenance) → Availability + Book Now → Ledger → Analytics → Customers → Pricing.
- **P6 — Integration & polish:** optimistic update + forced refetch, error/empty/loading states per the error matrix, live countdowns/toasts, responsive pass.
- **P7 — Verify & document:** boot both servers, smoke-test the core loop (login → start/end session → book → availability conflict → 409 → cancel), seed-reset script, finish README + spec-coverage notes.

---

## 9. How you'll run it

```bash
cd arenaze
cp .env.example .env
docker compose up -d        # Postgres
npm install
npm run db:migrate && npm run db:seed
npm run dev                 # server :4000 + web :5173 together
```

Login with seeded `admin / staff` demo accounts (printed by the seed script).

---

## 10. Deliberate decisions, deviations & defaults

- **CSS over Tailwind** — the PRD suggests Tailwind, but the design ships a polished bespoke
  CSS-variable system. I'm porting that verbatim for pixel fidelity; Tailwind can layer on later.
  *(This is the only deviation from the PRD's suggested FE stack.)*
- **Node/Fastify, not Rust/Axum** — PRD explicitly says backend language is "the team's call …
  language-agnostic." Node keeps one toolchain and meets every requirement.
- **Postgres via Docker** — no `psql` on this machine; Compose avoids any native install.
- **Demo tenant** kept as café **"Nexus LAN, Andheri West"** (a *customer* of Arenaze); the
  product/brand chrome is **Arenaze**.
- **Default theme:** maroon (brand); carbon/crimson + typeface/density switcher retained as a dev panel.
- **Consumer marketplace / payments gateway / hardware lock** — explicitly **out of scope** (PRD Phase 2+).

---

## 11. Open questions (non-blocking — I'll use the defaults above unless you say otherwise)

1. Keep the dev **tweaks panel** (theme switcher) in the shipped app, or strip it for a clean console?
2. Demo café name — keep "Nexus LAN", or rename to something Arenaze-branded?
3. Default landing theme — maroon (brand) or carbon (design's current default)?
