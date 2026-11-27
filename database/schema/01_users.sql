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
