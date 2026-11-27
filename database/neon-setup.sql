-- =====================================================================
-- Food Bank (Group 36) - ALL tables + service logins, for pasting into the Neon SQL Editor.
-- GENERATED from schema/01-04 and roles.sql (edit those, not this file). Safe to run again.
-- =====================================================================
BEGIN;
-- =====================================================================
-- 01 users - OWNER: Momen (authentication / identity)
-- Used by every service: who did what, and which role they have.
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  user_id        SERIAL PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  email          VARCHAR(255) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash  VARCHAR(255) NOT NULL,                 -- bcrypt hash, never the password
  role           VARCHAR(10)  NOT NULL CHECK (role IN ('staff', 'admin')),
  is_active      BOOLEAN      NOT NULL DEFAULT true,    -- admin can deactivate instead of deleting
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- =====================================================================
-- 02 food_items - OWNER: Mohamed (Donation & Inventory Management)
-- One row per donated batch: what, how much, from whom, and when it expires.
-- =====================================================================
CREATE TABLE IF NOT EXISTS food_items (
  item_id          SERIAL PRIMARY KEY,
  name             VARCHAR(120) NOT NULL,
  category         VARCHAR(30)  NOT NULL
                   CHECK (category IN ('dairy','bakery','fresh','dry','canned','frozen','beverages','hygiene','other')),
  quantity         INTEGER      NOT NULL CHECK (quantity >= 0),
  unit             VARCHAR(20)  NOT NULL DEFAULT 'unit',
  donation_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
  expiry_date      DATE         NOT NULL,
  donor_type       VARCHAR(15)  NOT NULL DEFAULT 'individual' CHECK (donor_type IN ('individual','shop','organization')),
  donor_name       VARCHAR(120),
  lot              VARCHAR(50),
  storage_location VARCHAR(50),
  created_by       INTEGER REFERENCES users(user_id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_items_expiry   ON food_items (expiry_date);
CREATE INDEX IF NOT EXISTS idx_food_items_category ON food_items (category);
CREATE INDEX IF NOT EXISTS idx_food_items_name     ON food_items (lower(name));

-- =====================================================================
-- 03 families, distributions, distribution_items - OWNER: Momen (Family Distribution)
-- A family receives many distributions; each distribution has one or more item lines.
-- Only the family data needed is stored (data minimisation): a reference, size, optional phone.
-- =====================================================================
CREATE TABLE IF NOT EXISTS families (
  family_id       SERIAL PRIMARY KEY,
  household_ref   VARCHAR(30) NOT NULL UNIQUE,
  household_size  INTEGER     NOT NULL CHECK (household_size BETWEEN 1 AND 30),
  contact_phone   VARCHAR(30),
  status          VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      INTEGER REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS distributions (
  distribution_id SERIAL PRIMARY KEY,
  family_id       INTEGER     NOT NULL REFERENCES families(family_id),
  staff_user_id   INTEGER     NOT NULL REFERENCES users(user_id),
  distributed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS idx_distributions_date   ON distributions (distributed_at);
CREATE INDEX IF NOT EXISTS idx_distributions_family ON distributions (family_id);

CREATE TABLE IF NOT EXISTS distribution_items (
  distribution_item_id SERIAL PRIMARY KEY,
  distribution_id      INTEGER NOT NULL REFERENCES distributions(distribution_id) ON DELETE CASCADE,
  item_id              INTEGER NOT NULL REFERENCES food_items(item_id),
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (distribution_id, item_id)
);

-- =====================================================================
-- 04 alert_settings, expiry_alerts, saved_reports - OWNER: Nancy (Expiry Alerts & Reporting)
-- Needs users and food_items (files 01 and 02) to exist first.
-- =====================================================================

-- One row only (id = 1). Admin-editable thresholds and email recipients.
CREATE TABLE IF NOT EXISTS alert_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  warning_days   INTEGER NOT NULL DEFAULT 7 CHECK (warning_days BETWEEN 1 AND 90),
  critical_days  INTEGER NOT NULL DEFAULT 2 CHECK (critical_days BETWEEN 0 AND 30),
  email_enabled  BOOLEAN NOT NULL DEFAULT false,
  notify_emails  TEXT[]  NOT NULL DEFAULT '{}',
  updated_by     INTEGER REFERENCES users(user_id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (critical_days < warning_days)
);
INSERT INTO alert_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- One alert per item per severity level. Workflow: open -> acknowledged -> resolved.
CREATE TABLE IF NOT EXISTS expiry_alerts (
  alert_id          SERIAL PRIMARY KEY,
  item_id           INTEGER     NOT NULL REFERENCES food_items(item_id) ON DELETE CASCADE,
  level             VARCHAR(10) NOT NULL CHECK (level IN ('warning', 'critical', 'expired')),
  status            VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  quantity_at_alert INTEGER     NOT NULL,
  expiry_date       DATE        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  emailed_at        TIMESTAMPTZ,
  acknowledged_by   INTEGER REFERENCES users(user_id),
  acknowledged_at   TIMESTAMPTZ,
  resolved_by       INTEGER REFERENCES users(user_id),
  resolved_at       TIMESTAMPTZ,
  resolution_action VARCHAR(20) CHECK (resolution_action IN ('distributed', 'discarded', 'transferred', 'escalated', 'stock_cleared', 'other')),
  resolution_note   VARCHAR(300),
  resolved_quantity INTEGER -- units actually removed from stock when discarded/transferred
);
-- Stops the scanner creating duplicate active alerts for the same item and level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_alert_per_item_level
  ON expiry_alerts (item_id, level) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_alerts_status ON expiry_alerts (status);

-- Metadata for report exports. The CSV file itself lives in S3.
CREATE TABLE IF NOT EXISTS saved_reports (
  report_id      SERIAL PRIMARY KEY,
  owner_user_id  INTEGER     NOT NULL REFERENCES users(user_id),
  report_type    VARCHAR(20) NOT NULL CHECK (report_type IN ('inventory', 'distributions', 'waste')),
  filters        JSONB       NOT NULL DEFAULT '{}',
  s3_key         VARCHAR(300) NOT NULL UNIQUE,
  row_count      INTEGER     NOT NULL,
  size_bytes     INTEGER     NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_reports_owner ON saved_reports (owner_user_id);

-- =====================================================================
-- Least privilege: one database login per backend.
-- Created with SQL ON PURPOSE: Neon gives roles created in the Console/API/CLI the admin-level
-- neon_superuser membership, while SQL-created roles start with almost no rights and get only
-- the grants below.
-- Passwords: none are set here (so none is ever written in a file). Each owner generates their own:
--   Neon Console -> project -> Branches -> production -> Roles & Databases -> role menu -> Reset password
-- Run this file in the Neon SQL Editor as the owner (neondb_owner), after the tables exist.
-- Safe to run again.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'inventory_service')    THEN CREATE ROLE inventory_service LOGIN;    END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'distribution_service') THEN CREATE ROLE distribution_service LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'alerts_service')       THEN CREATE ROLE alerts_service LOGIN;       END IF;
END $$;

GRANT USAGE ON SCHEMA public TO inventory_service, distribution_service, alerts_service;

-- ---------- Mohamed: inventory_service ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON food_items TO inventory_service;
GRANT USAGE, SELECT ON SEQUENCE food_items_item_id_seq TO inventory_service;
GRANT SELECT (user_id, name, role) ON users TO inventory_service;       -- show who added an item; no hashes
GRANT SELECT (item_id) ON distribution_items TO inventory_service;      -- deletion history check only; no distribution details or writes

-- ---------- Momen: distribution_service (+ authentication) ----------
GRANT SELECT, INSERT, UPDATE ON users TO distribution_service;          -- login, create users, change roles (no DELETE: deactivate instead)
GRANT USAGE, SELECT ON SEQUENCE users_user_id_seq TO distribution_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON families, distributions, distribution_items TO distribution_service;
GRANT USAGE, SELECT ON SEQUENCE families_family_id_seq, distributions_distribution_id_seq,
      distribution_items_distribution_item_id_seq TO distribution_service;
GRANT SELECT ON food_items TO distribution_service;
-- The one exception to "only the owner writes": recording a distribution must check and reduce stock
-- in the SAME transaction (proposal threat 5, concurrent distributions). So Momen may change ONLY
-- these two columns of Mohamed's table, nothing else.
GRANT UPDATE (quantity, updated_at) ON food_items TO distribution_service;

-- ---------- Nancy: alerts_service ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON alert_settings, expiry_alerts, saved_reports TO alerts_service;
GRANT USAGE, SELECT ON SEQUENCE expiry_alerts_alert_id_seq, saved_reports_report_id_seq TO alerts_service;
GRANT SELECT ON food_items, families, distributions, distribution_items TO alerts_service;  -- reports only
GRANT SELECT (user_id, name, role) ON users TO alerts_service;          -- show who handled an alert; no hashes/emails
-- Stock changes from Nancy's service go through Mohamed's API, never directly.

COMMIT;
