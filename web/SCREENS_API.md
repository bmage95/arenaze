# Arenaze Web — Screens Handoff (Foundation → Screens)

The **Frontend Platform** foundation is built. This document is the contract for the
**Screens agent** building the data views on top of it. Everything below already
exists and works; you should not need to touch `api/`, `auth/`, `main.tsx`,
`router.tsx` wiring, or `styles/tokens.css` (except to add screen-specific CSS if
truly needed).

Import shared types + money helpers from `@arenaze/shared`:

```ts
import { type DeviceSnapshot, type BookingDTO, formatPaise } from '@arenaze/shared';
```

---

## 1. How to add a screen

Each data view is already **routed** and rendered inside `<AppLayout/>` (sidebar +
topbar + scroll area). Today each route renders `<Placeholder title="…"/>`. To ship
a screen:

1. Create the component in `src/views/`, e.g. `src/views/Floor.tsx` exporting `Floor`.
2. In `src/router.tsx`, replace the matching `<Placeholder .../>` element with your
   component. Routes are fixed:

   | Path | View | Role |
   |---|---|---|
   | `/` (index) | Floor / Device Monitor | admin + staff |
   | `/availability` | Check Availability | admin + staff |
   | `/ledger` | Booking Ledger | admin + staff |
   | `/customers` | Customers | admin + staff |
   | `/analytics` | Analytics | **admin only** (guarded by `<RequireAdmin>`) |
   | `/pricing` | Pricing | **admin only** (guarded by `<RequireAdmin>`) |

   Admin-only routes are already wrapped in `<RequireAdmin>` **and** their nav items
   are hidden for staff in `Sidebar.tsx`. The server also 403s — handle that error
   too (see §6).

Your view renders directly into `.scroll`; it does **not** render the sidebar/topbar.
The page title in the topbar is derived from the route path (see `Topbar.tsx`
`TITLES`); add an entry there if you introduce a new path.

The current user is available via `useAuth()` (`src/auth/AuthContext.tsx`):

```ts
const { user, logout } = useAuth(); // user: AuthUser | null  → user.role, user.displayName, user.tenantName
```

---

## 2. Data hooks — `src/api/queries.ts`

All queries return TanStack Query v5 `UseQueryResult<T, ApiError>`
(`.data`, `.isLoading`, `.isError`, `.error`, `.refetch`, …).

| Hook | Signature | `.data` type | Notes |
|---|---|---|---|
| `useDevices()` | `()` | `DeviceSnapshot[]` | **polls every 10s** |
| `useDashboardTiles()` | `()` | `DashboardTiles` | **polls every 10s** (also used by Topbar) |
| `useBookings(filters?)` | `(filters?: LedgerQuery)` | `BookingDTO[]` | `LedgerQuery = { from?, to?, status? }` |
| `useCustomers(q?)` | `(q?: string)` | `CustomerDTO[]` | search by name/handle |
| `useCustomer(id)` | `(id: string)` | `CustomerDetail` | disabled when `id` is falsy |
| `usePricing()` | `()` | `PricingRuleDTO[]` | admin |
| `useAnalyticsOverview()` | `()` | `AnalyticsOverview` | admin |

Mutations return `UseMutationResult`; call `.mutate(vars)` or `await .mutateAsync(vars)`.
**Each one already invalidates the live floor (`['devices']` + `['dashboardTiles']`)
plus the relevant list on success** — you do not need to refetch manually.

| Hook | `mutate(vars)` | Returns |
|---|---|---|
| `useStartDevice()` | `{ id: string; req: StartSessionReq }` | `StartSessionRes` |
| `useEndSession()` | `id: string` | `EndSessionRes` |
| `useExtendDevice()` | `{ id: string; req: ExtendDeviceReq }` | `DeviceSnapshot` |
| `usePatchDevice()` | `{ id: string; req: PatchDeviceReq }` | `DeviceSnapshot` |
| `useCreateDevice()` | `CreateDeviceReq` | `DeviceSnapshot` |
| `useCreateBooking()` | `BookingCreateReq` | `BookingDTO` (a fresh `Idempotency-Key` is attached automatically) |
| `useStartBooking()` | `id: string` | `BookingDTO` |
| `useExtendBooking()` | `{ id: string; req: BookingExtendReq }` | `BookingDTO` |
| `useCancelBooking()` | `id: string` | `BookingDTO` |
| `useUpdatePricing()` | `{ id: string; req: PricingUpdateReq }` | `PricingRuleDTO` (also refreshes the floor — rate cascades to devices) |

Example:

```tsx
const start = useStartDevice();
const { notify } = useToast();

start.mutate(
  { id: device.id, req: { playerLabel: 'Walk-in', durationMinutes: 60 } },
  {
    onSuccess: (res) => notify(<>Seated on <b>{res.device.label}</b></>),
    onError: (e) => notify(<>{e instanceof ApiError ? e.message : 'Failed'}</>),
  },
);
```

**Query keys** are exported as `queryKeys` from `queries.ts` if you need manual
`queryClient.invalidateQueries(...)` (e.g. `queryKeys.customer(id)`).

### Availability (no hook — call the client directly)

`POST /api/availability/search` has no dedicated hook (it's request-shaped). Call it
imperatively, optionally via your own `useMutation`:

```ts
import { searchAvailability } from '../api/client';
const res = await searchAvailability({ deviceType: 'PC', guests: 5, startAt, durationMinutes: 180, extendable: false });
// res.ok, res.slot.matches[], res.nearest (when !ok)
```

Other raw client fns in `src/api/client.ts` (typed, auth + refresh handled):
`login, refresh, logout, forgotPassword, getDevices, startDevice, endSession,
extendDevice, patchDevice, createDevice, getDashboardTiles, searchAvailability,
createBooking, startBooking, extendBooking, cancelBooking, listBookings,
listCustomers, getCustomer, listPricing, updatePricing, getAnalyticsOverview`.

---

## 3. Toasts — `useToast()`

```tsx
import { useToast } from '../components/Toast';
const { notify } = useToast();
notify(<>Seated <b>RIG-01</b> · 60 min</>); // ReactNode; auto-dismisses ~3.4s
```

---

## 4. UI primitives — `src/components/`

| Component | Props |
|---|---|
| `Pill` | `{ kind: 'ok' \| 'warn' \| 'busy' \| 'off'; children }` |
| `Metric` | `{ k, v, unit?, pre?, sub?, subc?: 'up' \| 'down' \| '' }` (k=label, v=value, pre=leading glyph e.g. `₹`, unit=trailing `<small>`) |
| `Chip` | `{ on?, dot?, onClick?, children }` (toggle/segment chip) |
| `Drawer` | `{ open, onClose, title?, header?, footer?, children }` — renders `.scrim`+`.drawer` with `.dh`/`.db`/`.df`; a close X is always added top-right |
| `Modal` | `{ open, onClose, width?, children }` — renders `.scrim`+`.card`; compose your own header/X inside |
| `icons` | `import { I, Logo } from '../components/icons'` → `I.floor, I.res, I.avail, I.ana, I.mem, I.price, I.logout, I.x` |

`Drawer`/`Modal` return `null` when `!open`, so you can always render them.

---

## 5. Design classes per screen (all in `styles/tokens.css`, ported verbatim)

Use the design's bespoke classes — **do not** add a CSS framework. Key building blocks:

- **Section head:** `.shead` → `.t` (title) + `.t .ct` (count kicker).
- **Metrics row:** `<div className="metrics">` with four `<Metric/>` cards.
- **Floor / Device Monitor:** filter chips in `.filters` (`.chip`/`.chip.on` with `.dot`);
  grid `.stations` of `.tile`. Status modifier on the tile: `.tile.active | .free | .maint`
  (drives the left `.bar` color + `.tm` color). Inside a tile: `.pf` (top-right platform),
  `.id`, `.spec`, `.who`, `.tm`. Add `.flash` briefly after seating for the seat-flash anim.
  `DeviceSnapshot.status` is `available | active | reserved | maintenance` — map
  `available→free`, `maintenance→maint`, `active→active` for the tile class (`reserved`
  can reuse `.free` with a different `.tm`/pill, your call).
- **Tables (Ledger, Customers):** `<div className="panel"><table className="tbl">…</table></div>`.
  Bold cells via `<b>`. Customer tier badge: `<span className="tier Elite|Pro|Casual">`.
- **Search bar (Availability, Customers):** `.searchbar` containing `.input` + a `.btn`.
- **Charts (Analytics):** `.charts` → two `.chart`; each chart has a `.shead` + `.bars`;
  each bar is `.b` (or `.b.alt` for the maroon variant) → `.col2` (set `style={{height: pct%}}`) + `.lb` label.
- **Drawer internals:** `.field`+`.lab` for inputs, `.seg` for chip groups, `.row` for
  horizontal groups, definition list `.dl` (`<dt>`/`<dd>`).
- **Buttons:** `.btn` + one of `.primary` (red — one per view), `.maroon`, `.ghost`; `.sm` for compact.
- **Empty state:** `<div className="empty">No …</div>`.
- **Forms / inputs:** `.input` (focus ring built in). Field label: `.field > .lab`.
- **Result cards (Availability):** `.cafe` card is available (header `.ph`, `.body`, `.nm`, `.loc`, `.price`).

The theme is controlled by the dev **Tweaks panel** (bottom-right). Default is
`maroon / chakra / compact / chamfer / glow`. Don't hardcode colors — use the CSS
vars (`var(--text)`, `var(--maroon)`, `var(--red)`, `var(--faint)`, …).

---

## 6. Errors, money & time

- **Errors:** failed calls throw/`error` is an `ApiError` with `.status` and `.code`
  (`'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' |
  'slot_taken' | 'invalid_transition' | 'idempotency_replay' | 'internal'`).
  Notably handle **`slot_taken`** (409) on `useCreateBooking` → "slot just taken,
  pick another", and **`forbidden`** (403) on admin endpoints. A 401 triggers an
  automatic **silent refresh**; if that fails the user is force-logged-out and routed
  to `/login` — you don't handle that.
- **Money is integer paise.** Render with `formatPaise(paise)` → `"₹1,234"`, or
  `formatPaise(paise, { compact: true })` → `"₹1.2k"`. Helpers also available:
  `accruedPaise(elapsedSeconds, ratePaise)`, `quotePaise(minutes, ratePaise)`,
  `paiseToRupees`, `rupeesToPaise`. `ActiveSession.accruedPaise` /
  `BookingDTO.totalPaise` / `*.ratePaise` are already paise.
- **Time:** all timestamps are ISO-8601 strings. Render local with
  `new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`.
  For a live countdown, tick `Date.now()` each second and diff against
  `session.plannedEndAt`; for a live accrued tab, recompute with
  `accruedPaise((Date.now() - Date.parse(startedAt)) / 1000, ratePaise)`.

---

## 7. File map (what the foundation gives you)

```
web/
├─ index.html                 fonts + #root + data-theme defaults
├─ src/
│  ├─ main.tsx                providers (Query, Router, Auth, Toast) + QueryClient
│  ├─ router.tsx              routes (replace <Placeholder/> here)
│  ├─ vite-env.d.ts           VITE_API_BASE typing
│  ├─ styles/tokens.css       ported design system (themes + every component class)
│  ├─ api/client.ts           typed fetch client, tokens, silent refresh, ApiError
│  ├─ api/queries.ts          all hooks + queryKeys  ← you mostly live here
│  ├─ auth/AuthContext.tsx    useAuth(): { user, isAuthenticated, login, logout }
│  ├─ auth/ProtectedRoute.tsx ProtectedRoute + RequireAdmin
│  ├─ components/             Sidebar, Topbar, AppLayout, Pill, Metric, Chip,
│  │                          Drawer, Modal, Toast, icons, TweaksPanel, Placeholder
│  └─ views/Login.tsx         the login screen (done)
```

Verify your work with `npm -w @arenaze/web run typecheck` and `npm run dev:web`.
```
