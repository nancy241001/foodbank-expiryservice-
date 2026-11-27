# Database (Neon PostgreSQL) — all three services

One Neon database holds everything. Each service **owns** its tables (only it writes them) and
connects with **its own restricted login**.

| File | Owner | Tables |
|---|---|---|
| `schema/01_users.sql` | Momen (auth) | `users` |
| `schema/02_inventory.sql` | Mohamed | `food_items` |
| `schema/03_distribution.sql` | Momen | `families`, `distributions`, `distribution_items` |
| `schema/04_alerts_reporting.sql` | Nancy | `alert_settings`, `expiry_alerts`, `saved_reports` |
| `roles.sql` | Nancy (DB lead) | creates the three service logins and their grants |
| `neon-setup.sql` | generated | 01-04 + roles.sql in one transaction, for the Neon SQL Editor |
| `neon-seed.sql`, `neon-set-demo-passwords.sql` | Nancy | demo data, and the template for setting demo passwords |

Relationships: `users 1—* food_items (created_by)`, `families 1—* distributions 1—* distribution_items *—1 food_items`,
`users 1—* distributions (staff)`, `food_items 1—* expiry_alerts`, `users 1—* expiry_alerts (acknowledged/resolved by)`,
`users 1—* saved_reports (owner)`.

## Set it up on Neon

**Status: done on the FoodBank project (production branch, `neondb`), 22 Nov 2026.** All 8 tables,
the alert settings row and the three service logins exist. Re-running is safe if ever needed.

**1. Tables + service logins (already done).** Neon console → FoodBank → **SQL Editor** → paste
`neon-setup.sql` → **Run**. It is one transaction (`BEGIN … COMMIT`): everything is created or nothing is.

**2. Each student sets their own database password (nobody else sees it).**
Neon's **Reset password** button does not work for logins created with SQL, so set it with SQL:
Neon console → FoodBank → **SQL Editor** → run (typing your own password, 12+ characters with upper,
lower, number and symbol), then clear the editor:
```sql
ALTER ROLE alerts_service WITH PASSWORD 'your-own-password';   -- Mohamed: inventory_service, Momen: distribution_service
```
The logins were created **with SQL on purpose**: Neon makes roles created in the Console/API
administrators (`neon_superuser`), which would defeat least privilege.

Your backend's `DATABASE_URL` is then (host from the **Connect** button):
`postgresql://alerts_service:PASSWORD@HOST/neondb?sslmode=require`

**3. Demo data (already done, 22 Nov 2026).** `neon-seed.sql` was run in the SQL Editor: 3 users,
19 items (1,114 units in stock), 6 families, 8 distributions (22 lines), with stock reduced for every line.
It only runs on an empty database. The three demo users were created **locked** (no usable password).

**3b. Demo login passwords (you do this).** Paste `neon-set-demo-passwords.sql` into the SQL Editor,
replace the two placeholders with your own passwords (10+ characters), **Run**, then clear the editor.
Only a bcrypt hash is stored (Neon's `pgcrypto`, the same format `bcryptjs` checks).
Logins: `admin@foodbank.local` (admin), `staff1@foodbank.local` and `staff2@foodbank.local` (staff).

(Alternative from a PC: `npm run seed` with the owner string in `database/.env` does steps 3 and 3b together
on an empty database.)

**4. Evidence for the report (security test ST-16).** Connect as `alerts_service` (e.g. `psql` with its
string) and run `UPDATE food_items SET quantity = 999;` and `SELECT password_hash FROM users;`.
Both must say *permission denied*. Screenshot it.

## Why it is built this way
- **One transaction for setup and seed**: if anything fails, nothing is half-created.
- **Constraints in the database** (`CHECK`, `UNIQUE`, foreign keys): bad data is refused even if a backend has a bug.
- **Separate logins**: a bug or attack in one service cannot change another service's data. Nancy's
  login cannot even read password hashes or emails. The single exception is that Momen's login may update
  `food_items.quantity`, because a distribution must check and reduce stock in the same transaction
  (otherwise two staff could hand out the same last items at once).
- **Demo users get bcrypt hashes** made from passwords you choose, so no password is written in the repo.
- **Recovery**: Neon keeps history (point-in-time restore on the free plan for a limited window) and
  branches; the schema itself can always be recreated with `npm run setup`.
