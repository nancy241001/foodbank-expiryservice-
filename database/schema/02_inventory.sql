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
