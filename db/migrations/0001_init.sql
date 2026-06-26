-- ============================================================================
-- Arenaze — Phase 1 schema (CafeHub PRD v2 §6)
-- All money in integer paise. Every domain row carries tenant_id.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality opclass for the exclusion constraint

-- ---------------------------------------------------------------------------
-- tenants  (a café — a customer of Arenaze)
-- ---------------------------------------------------------------------------
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  area        text NOT NULL DEFAULT '',
  code        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users  (admin | staff)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username      text NOT NULL,
  password_hash text NOT NULL,                       -- argon2id
  display_name  text NOT NULL DEFAULT '',
  role          text NOT NULL CHECK (role IN ('admin','staff')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username)
);

-- ---------------------------------------------------------------------------
-- refresh_tokens  (hashed, rotated, revocable — survives restart)
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,                          -- sha-256 of the opaque refresh token
  expires_at  timestamptz NOT NULL,
  revoked     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id) WHERE NOT revoked;

-- ---------------------------------------------------------------------------
-- devices  (status here is operator-set; 'active'/'reserved' are derived on read)
-- ---------------------------------------------------------------------------
CREATE TABLE devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label       text NOT NULL,                          -- 'RIG-01', 'PS5-1', ...
  type        text NOT NULL CHECK (type IN ('PC','PS5','Xbox','VR')),
  spec        text NOT NULL DEFAULT '',
  rate_paise  integer NOT NULL CHECK (rate_paise >= 0),
  status      text NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, label)
);
CREATE INDEX idx_devices_tenant ON devices(tenant_id, sort_order);

-- ---------------------------------------------------------------------------
-- customers  (CRM; hours/spend/last-seen are derived, not stored)
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  handle      text NOT NULL DEFAULT '',
  phone       text,
  tier        text NOT NULL DEFAULT 'Casual' CHECK (tier IN ('Casual','Pro','Elite')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_search ON customers(tenant_id, lower(name), lower(handle));

-- ---------------------------------------------------------------------------
-- pricing_rules  (one hourly rate per device type per tenant; admin-edited)
-- ---------------------------------------------------------------------------
CREATE TABLE pricing_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_type text NOT NULL CHECK (device_type IN ('PC','PS5','Xbox','VR')),
  rate_paise  integer NOT NULL CHECK (rate_paise >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_type)
);

-- ---------------------------------------------------------------------------
-- bookings  (header; per-device slots live in booking_devices)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS booking_code_seq START 8847;  -- continues GG-8846 from the design seed

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            text NOT NULL,                      -- 'GG-8847'
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  guests          integer NOT NULL DEFAULT 1 CHECK (guests >= 1),
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  status          text NOT NULL CHECK (status IN ('upcoming','active','completed','cancelled')),
  extendable      boolean NOT NULL DEFAULT false,
  total_paise     integer NOT NULL DEFAULT 0,
  note            text,
  idempotency_key text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX idx_bookings_idem ON bookings(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_bookings_tenant_time ON bookings(tenant_id, start_at);
CREATE INDEX idx_bookings_status ON bookings(tenant_id, status);

-- ---------------------------------------------------------------------------
-- booking_devices  *** LOAD-BEARING: makes double-booking impossible ***
--   slot is generated from start/end; the exclusion constraint rejects any
--   overlapping slot on the same device while it is upcoming/active.
--   cancelled/completed rows free the slot.
-- ---------------------------------------------------------------------------
CREATE TABLE booking_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  start_at    timestamptz NOT NULL,
  end_at      timestamptz NOT NULL,
  slot        tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
  status      text NOT NULL CHECK (status IN ('upcoming','active','completed','cancelled')),
  rate_paise  integer NOT NULL CHECK (rate_paise >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  CONSTRAINT no_double_book EXCLUDE USING gist (
    device_id WITH =,
    slot WITH &&
  ) WHERE (status IN ('upcoming','active'))
);
CREATE INDEX idx_bd_booking ON booking_devices(booking_id);
CREATE INDEX idx_bd_device_live ON booking_devices(device_id, status) WHERE status IN ('upcoming','active');

-- ---------------------------------------------------------------------------
-- sessions  (actual play; accrued bill derived on read, finalized on end)
--   one active (un-ended) session per device, enforced by a partial unique index.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id         uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  booking_id        uuid REFERENCES bookings(id) ON DELETE SET NULL,
  booking_device_id uuid REFERENCES booking_devices(id) ON DELETE SET NULL,
  customer_id       uuid REFERENCES customers(id) ON DELETE SET NULL,
  player_label      text NOT NULL DEFAULT 'Walk-in',
  rate_paise        integer NOT NULL CHECK (rate_paise >= 0),
  started_at        timestamptz NOT NULL DEFAULT now(),
  planned_end_at    timestamptz,
  ended_at          timestamptz,
  accrued_paise     integer,                          -- NULL while active; set on checkout
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_session_active_device ON sessions(device_id) WHERE ended_at IS NULL;
CREATE INDEX idx_sessions_tenant_time ON sessions(tenant_id, started_at);

-- ---------------------------------------------------------------------------
-- transactions  (the account ledger; finalized session/booking charges)
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id   uuid REFERENCES bookings(id) ON DELETE SET NULL,
  session_id   uuid REFERENCES sessions(id) ON DELETE SET NULL,
  customer_id  uuid REFERENCES customers(id) ON DELETE SET NULL,
  device_id    uuid REFERENCES devices(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('session','booking','refund')),
  amount_paise integer NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_tenant_time ON transactions(tenant_id, created_at);
CREATE INDEX idx_tx_customer ON transactions(customer_id);

-- ---------------------------------------------------------------------------
-- audit_log  (every mutation writes one row)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,                          -- 'booking.create', 'session.end', ...
  entity      text NOT NULL DEFAULT '',
  entity_id   text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant_time ON audit_log(tenant_id, created_at);
