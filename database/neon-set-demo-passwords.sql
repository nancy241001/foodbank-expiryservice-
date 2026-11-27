-- =====================================================================
-- Set the demo users' passwords. Type YOUR OWN passwords in place of the two placeholders
-- (10+ characters), run it in the Neon SQL Editor, then delete them from the editor.
-- The database stores only a bcrypt hash (the same format the backends check with bcryptjs).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE users SET password_hash = crypt('TYPE-ADMIN-PASSWORD-HERE', gen_salt('bf', 12)) WHERE email = 'admin@foodbank.local';
UPDATE users SET password_hash = crypt('TYPE-STAFF-PASSWORD-HERE', gen_salt('bf', 12)) WHERE email IN ('staff1@foodbank.local', 'staff2@foodbank.local');
