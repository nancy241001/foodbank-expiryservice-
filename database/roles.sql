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
