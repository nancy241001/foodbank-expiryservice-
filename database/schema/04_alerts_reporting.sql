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
