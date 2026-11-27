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
