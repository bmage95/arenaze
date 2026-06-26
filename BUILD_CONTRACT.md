# Arenaze — Build Contract (read me first)

You are one of several agents building **Arenaze**, a gaming-café operator console.
Authoritative plan: `PLAN.md`. Design source: `_design_ref/`. This file is the
**shared contract** — follow it exactly so the pieces fit together.

## Golden rules
1. **Stay in your assigned directory.** Do not edit files outside it (especially
   `shared/`, `package.json` at root, `db/migrations/`, or another agent's tree).
   If you need a new dependency, add it to **your** workspace `package.json` only.
2. **Code against `@arenaze/shared`** for all cross-cutting types. Import like
   `import { type DeviceSnapshot, formatPaise } from '@arenaze/shared';`. Do not
   redefine these shapes locally.
3. **Money is integer paise.** Never use floats for money. Use helpers in
   `shared/src/money.ts`.
4. **Times are ISO-8601 strings** over the wire; `timestamptz` in the DB.
5. **Multi-tenant:** `tenant_id` always comes from the JWT server-side, never the client.
6. The DB schema is fixed in `db/migrations/0001_init.sql`. Treat it as read-only truth.
7. Keep TypeScript strict; `npm -w @arenaze/<pkg> run typecheck` should pass for your package.

## Stack
- Monorepo via npm workspaces: `shared/`, `db/`, `server/`, `web/`.
- **server**: Node + TypeScript + **Fastify 5**, `pg`, **Zod**, `@node-rs/argon2`, `jsonwebtoken`. Run with `tsx`.
- **web**: **Vite 6 + React 18 + TS**, React Router 6, **TanStack Query 5**. Bespoke CSS (ported from the design).
- **db**: PostgreSQL 16 (via `docker-compose.yml`), `btree_gist` + `pgcrypto`.
- `.env` already exists (copied from `.env.example`). `DATABASE_URL` points at `localhost:5433`.

## Environment / how to verify
- DB is up via `docker compose up -d` (host port **5433**).
- `npm install` has been run at the root; all workspaces share one `node_modules`.
- Migrations: `npm run db:migrate`. Seed: `npm run db:seed`. Reset: `npm run db:reset`.
- Server dev: `npm run dev:server` (port 4000). Web dev: `npm run dev:web` (port 5173).

## Domain model (see `0001_init.sql` for the exact DDL)
`tenants · users · refresh_tokens · devices · customers · pricing_rules · bookings ·
booking_devices · sessions · transactions · audit_log`

- **devices.status** is operator-set: `available | maintenance`. The live floor status
  (`active`/`reserved`) is **derived on read** by joining active `sessions` / upcoming
  `booking_devices`.
- **booking_devices** carries the slot range + the `no_double_book` GiST exclusion
  constraint. Overlapping `upcoming|active` slots on one device are physically rejected.
- **sessions** = real play. `accrued_paise` is NULL while active and computed on read via
  `accruedPaise(elapsedSeconds, rate)`; finalized + written to `transactions` on checkout.
- A **walk-in** = a booking with `start_at <= now`, created already-`active`, with sessions opened.

## API (server implements, web consumes) — base `http://localhost:4000`
All under `/api`. `Authorization: Bearer <accessToken>` except auth endpoints.
Request/response bodies are the named types in `shared/src/api.ts`. Errors use
`ApiErrorBody` with the documented HTTP status.

| Method | Path | Body → Response | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `LoginReq` → `LoginRes` | argon2id verify; 401 on bad creds |
| POST | `/api/auth/refresh` | `RefreshReq` → `RefreshRes` | rotate refresh token; 401 if revoked/expired |
| POST | `/api/auth/logout` | `LogoutReq` → `{ok:true}` | revoke the refresh token |
| POST | `/api/auth/forgot-password` | `ForgotPasswordReq` → `ForgotPasswordRes` | always 200; demo logs a token |
| GET | `/api/devices` | → `DeviceSnapshot[]` | **the 10s floor poll**; derives status/accrued |
| POST | `/api/devices/:id/start` | `StartSessionReq` → `StartSessionRes` | seat a single walk-in (creates active booking+session) |
| POST | `/api/devices/:id/end-session` | → `EndSessionRes` | finalize accrued → transaction; frees device |
| POST | `/api/devices/:id/extend` | `ExtendDeviceReq` → `DeviceSnapshot` | push planned end +minutes |
| PATCH | `/api/devices/:id` | `PatchDeviceReq` → `DeviceSnapshot` | maintenance toggle / spec / rate (**admin**) |
| POST | `/api/devices` | `CreateDeviceReq` → `DeviceSnapshot` | **admin** |
| GET | `/api/dashboard/tiles` | → `DashboardTiles` | occupancy/active/reserved/revenue |
| POST | `/api/availability/search` | `AvailabilitySearchReq` → `AvailabilitySearchRes` | matches + nearest-slot fallback |
| POST | `/api/bookings` | `BookingCreateReq` (+ `Idempotency-Key` header) → 201 `BookingDTO` | **serializable**; 409 `slot_taken` on race |
| POST | `/api/bookings/:id/start` | → `BookingDTO` | check-in: upcoming→active, open sessions |
| POST | `/api/bookings/:id/extend` | `BookingExtendReq` → `BookingDTO` | |
| POST | `/api/bookings/:id/cancel` | → `BookingDTO` | active/upcoming→cancelled, frees slots |
| GET | `/api/bookings?from&to&status` | → `BookingDTO[]` | the ledger (Epic D) |
| GET | `/api/customers?q=` | → `CustomerDTO[]` | search by name/handle |
| GET | `/api/customers/:id` | → `CustomerDetail` | with booking history |
| GET | `/api/pricing` | → `PricingRuleDTO[]` | **admin** |
| PATCH | `/api/pricing/:id` | `PricingUpdateReq` → `PricingRuleDTO` | **admin**; cascades rate to devices of that type |
| GET | `/api/analytics/overview` | → `AnalyticsOverview` | **admin** |

**Role gating (server-enforced, 403 for staff):** `analytics` + `pricing` are admin-only;
device `PATCH`/`POST` (manage) are admin-only. Everything else: admin + staff.

**Correctness guarantees to honor** (PRD §7): exclusion constraint; serializable booking
create with re-validation → loser gets 409 `slot_taken`; `Idempotency-Key` replay returns the
original booking; argon2id + JWT (access 15m, refresh hashed/rotated/revocable); accrued bill
derived on read and surviving restart; state machines + role checks server-side; `audit_log`
on every mutation.

## Demo seed expectations (so login & the floor look alive)
- One tenant: **"Nexus LAN", Andheri West** (`code` e.g. `NXS-001`).
- Users from `.env`: `admin/admin123` (role admin), `staff/staff123` (role staff), argon2id-hashed.
- 24 devices ported from `_design_ref/gg-data.js`: 16 PC (RIG-01..16, RTX 4070→₹220/hr, 4060→₹160/hr),
  4 PS5 (₹200), 2 Xbox (₹200), 2 VR (₹300). One PC in maintenance. **Rates stored in paise.**
- `pricing_rules`: one row per type matching the above.
- ~6 customers ported from `gg-data.js` members.
- Live state: several **active** sessions (so the floor shows countdowns + accrued tabs) and
  several **upcoming** bookings/reservations (ported from `gg-data.js` reservations), all with
  valid non-overlapping `booking_devices` slots. A few completed sessions today with
  `transactions` so "revenue today" and analytics are non-zero.

## Design fidelity (web)
Port the look **verbatim** from `_design_ref/GameGrid Operator.html` (app CSS: `.app`, `.side`,
`.topbar`, `.tile`, `.drawer`, `.modal`, `.toast`, metrics, pills, chips, tables, charts) and
`_design_ref/GameGrid Design System.html` (tokens). Rebrand "GameGrid" → **Arenaze**. The React
structure to port is `_design_ref/gg-app.jsx`. Default theme **maroon**. Keep the theme/typeface
tweaks panel as a dev panel. Fonts via Google Fonts `<link>` (Chakra Petch, Hanken Grotesk,
JetBrains Mono; Venite Adoremus via cdnfonts with fallback to Chakra Petch).
