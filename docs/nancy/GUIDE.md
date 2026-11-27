# Nancy's component — Expiry Alerts & Reporting
### Step-by-step: what was built, why, and how to run and defend it

> **Read this whole file before the discussion.** The examiner will ask you to explain your
> code, not just show it. Every section below ends with **"Why"**, which is the part you
> should be able to say in your own words.

---

## Separate backends: what this means and why (read first)

Each student has **their own backend**: a separate Express app with its own folder, `package.json`,
`.env`, port, tests and deployment (Nancy's: `services/alerts-reporting-service`, port 3003, its own
Lambda + API Gateway). The brief still requires **one integrated application**, so the backends share:

| Shared thing | How it works | Why |
|---|---|---|
| **Login** | Momen's service issues a JWT; Nancy's backend only **verifies** it (`src/middleware/auth.js`) with the same `JWT_SECRET` | separate backends share no memory, so each must check the token itself; one login works everywhere |
| **Data** | one Neon database; each backend **writes only its own tables**; Nancy has a **read-only** login for the teammates' tables (`database/roles.sql`) | reports need inventory and distribution data; read-only means a bug or attack in Nancy's service cannot change their data |
| **Changes to another service's data** | through that service's **API**: Nancy calls Mohamed's `PATCH /api/items/{id}` (`src/clients/inventoryClient.js`) | the owner's validation, roles and logs still apply; this is real service-to-service communication |
| **Frontend** | one shared frontend; `frontend/js/config.js` maps each URL prefix to the right backend | users see one app with one navigation bar |

What the examiner may ask:
- **"Why not let Nancy's backend update `food_items` directly?"** Then two services would change the
  same table with different rules. Only the owner changes its data; others ask through its API.
- **"What if Mohamed's backend is down when staff discard food?"** The call times out after 5 s,
  Nancy's backend returns **502**, the database transaction rolls back and the alert stays open, so the
  two services never disagree. It is logged as `INVENTORY_SERVICE_UNREACHABLE` and counted by a metric filter.
  Everything else in Nancy's service keeps working (alerts, reports), which is a benefit of separate backends.
- **"Why forward the user's token instead of a service password?"** Mohamed's service then checks the
  *same user's* role, so Nancy's backend cannot do more in Inventory than the user could do themselves.
- **Trade-off:** separate backends mean more to deploy and configure (3 URLs, 3 sets of secrets) and a
  network call where there used to be a function call. In exchange, each student owns, deploys and
  scales their part independently, and a failure in one does not take down the others.

---

## 0. What Nancy owns (from the Phase 1 proposal)

| Proposal said | What was built |
|---|---|
| Look up items that are almost expired | **F1** `GET /api/alerts/expiry`: live list, sorted soonest-first, with severity levels |
| View alerts for staff | **F2** stored alerts: scan, list, acknowledge → resolve workflow, email notification |
| Create summary reports of inventory and distribution | **F3** inventory, distributions and waste reports with calculations |
| Filter reports by category and date | Filters on every report, plus **F4** CSV exports saved in S3 |
| Only staff can view alerts/reports | `requireAuth` + `requireRole` on every route; admin-only settings; ownership checks |
| Notification and dashboard integration | Email digest (external SMTP), nav badge on every page, dashboard tiles |
| Shared: **Database setup lead** | the whole `database/` folder: schema files for all services, setup/seed/status scripts, `roles.sql` |
| Shared: **Report and threat model lead** | `docs/nancy/REPORT_SECTIONS.md` |

**Why four functions when three are required?** The brief warns that "CRUD-only" services
lose marks. Nancy's service has real business rules (severity, de-duplication, escalation,
workflow, food-safety rules, waste rate) and talks to **both** other services. That is the
strongest answer to "is this just CRUD?".

---

## 1. Folder layout

```
database/  schema/01-04 (one file per owner), setup.js, seed.js, status.js, roles.sql  <- Nancy (DB lead)
services/alerts-reporting-service/                                  <- Nancy's own backend
  src/
    app.js, server.js, config.js       # Express app, startup, settings from env
    db/  pool.js, migrate.js           # migrate = Nancy's file 04 only (local/tests)
    middleware/auth.js                 # verifies tokens issued by Momen's auth
    clients/inventoryClient.js         # HTTP calls to Mohamed's backend
    constants.js
    utils/  validate.js, logger.js, csv.js, httpError.js
    aws/    clients.js, s3Storage.js, secrets.js, metrics.js
    services/alerts/   alertRoutes, alertController, alertService, notifier
    services/reports/  reportRoutes, reportController, reportService, exportService
    lambda/apiHandler.js (backend on Lambda), expiryScanHandler.js (daily scan)
  scripts/ test-token.js               # TEST ONLY: token for Postman until Momen's login exists
  tests/   alerts, reports, security, inventoryClient tests
services/inventory-service/, services/distribution-service/   <- Mohamed's / Momen's (contracts in their README)
frontend/  alerts.html, reports.html, index.html, js/*, css/nancy.css <- Nancy (login.html shared)
infra/floci/ compose.yaml, setup-nancy.sh, build-lambda.sh, policies/*.json <- Nancy
docs/nancy/  this guide, REPORT_SECTIONS.md, requests.http
```

**Why routes → controller → service?** Each layer has one job:
- **route**: which URL + which roles may call it
- **controller**: read and validate the request, choose the status code
- **service**: the business rules and SQL

The service has no idea about HTTP, so the **same `runScan()`** is called by the "Run scan"
button (through the API) and by the daily Lambda. The rules live in one place.

---

## 2. Step 1 — The database (Nancy is DB lead)

Files: `database/schema/01-04` (one file per owner; Nancy's tables are in `04_alerts_reporting.sql`),
`database/setup.js` / `seed.js` / `status.js`, and `database/roles.sql` (one login per backend).
How to run it on Neon and why it is built this way: `database/README.md`.

Tables and who uses them:

| Table | Written by | Read by Nancy for |
|---|---|---|
| `users` | Auth (Momen) | who acknowledged/resolved, export owner (only `user_id, name, role` are readable) |
| `food_items` | Inventory (Mohamed) | expiry look-up, scan, inventory report |
| `families`, `distributions`, `distribution_items` | Distribution (Momen) | distribution report |
| `alert_settings` (1 row) | Nancy (admin) | warning/critical days, email recipients |
| `expiry_alerts` | Nancy | alert list, workflow, waste report |
| `saved_reports` | Nancy | list/download/delete exports (file is in S3) |

Important design choices:

1. **`CHECK` constraints** (e.g. `quantity >= 0`, `level IN (...)`, `critical_days < warning_days`).
   *Why:* even if a bug in the code lets bad data through, the database refuses it. Defence in depth.
2. **Partial unique index** `uq_active_alert_per_item_level ... WHERE status <> 'resolved'`.
   *Why:* the database itself guarantees there can never be two active alerts for the same item
   and level, even if two scans run at the same time.
3. **Indexes on `expiry_date` and `category`.** *Why:* every alert query filters on these.
4. **`alert_settings` has exactly one row** (`CHECK (id = 1)`). *Why:* there is one food bank;
   thresholds are global and editable without changing code.
5. **Only metadata of exports in Postgres; the CSV file in S3.** *Why:* databases are for
   structured rows, object storage is cheaper and built for files.
6. `IF NOT EXISTS` everywhere. *Why:* running the migration twice does no harm (idempotent).
7. **One database login per backend** (`database/roles.sql`). Nancy's `alerts_service` login owns her
   3 tables, can only `SELECT` the teammates' tables, and cannot even read password hashes or emails.
   *Why:* least privilege at the database level, not just in the code.

Also in `db/pool.js`:
- **Connection pool** (`max: 5`) re-uses connections. *Why:* Neon's free tier limits connections.
- **TLS to Neon** (`ssl: { rejectUnauthorized: true }`). *Why:* data is encrypted in transit.
- **DATE returned as text**. *Why:* otherwise Node converts `2026-11-23` to a local-time Date and
  the expiry date can shift by a day. (A real bug this avoids, which is good to mention as a difficulty.)
- **Parameterised queries** (`$1, $2`). *Why:* user input is never pasted into SQL, so SQL injection is impossible.
- `withTransaction()`. *Why:* all-or-nothing changes (see the scan and the resolve step).

---

## 3. Step 2 — Validation (`utils/validate.js`)

Every input is checked **on the server** before it reaches the database:

| Validator | Example rejection (400) |
|---|---|
| `positiveId` | `/api/alerts/abc`, `/api/alerts/1 OR 1=1` |
| `intInRange` | `days=0`, `days=500` |
| `oneOf` | `category=weapons`, `status=open` in PATCH |
| `isoDate` | `2026-02-31` (not a real date), `31-01-2026` |
| `dateRange` | `from` after `to`, more than 366 days |
| `emailList` | `"not-an-email"`, more than 10 addresses |
| `onlyFields` | a body containing `acknowledged_by` or `s3_key` |

**Why `onlyFields`?** It blocks *mass assignment*. Without it, an attacker could send
`{"status":"acknowledged","acknowledged_by":5}` and pretend someone else handled the alert,
or send `s3_key` to write into another user's folder.

**Why validate on the server when the form already checks?** Anyone can call the API
directly with Postman or curl and skip the browser completely.

---

## 4. Step 3 — Authentication and roles (`src/middleware/auth.js`)

Momen's backend **issues** the token at login. Nancy's backend has no login route; it only **verifies**
the token on every request (same `JWT_SECRET`, from Secrets Manager).

- `requireAuth` reads `Authorization: Bearer <JWT>`, verifies the signature with `JWT_SECRET`,
  **only allows HS256** (blocks the `alg: none` trick), and rejects expired tokens. → **401**
- `requireRole('staff','admin')` → **403** for any other role.

Nancy's permission matrix (enforced in `alertRoutes.js`, `reportRoutes.js` and the services):

| Action | Not logged in | Staff | Admin | Where enforced |
|---|---|---|---|---|
| Look up expiring items, view alerts, run scan | 401 | ✔ | ✔ | `requireRole('staff','admin')` |
| Acknowledge an alert | 401 | ✔ | ✔ | route + workflow in `alertService` |
| Resolve an alert someone else acknowledged | 401 | **403** | ✔ | **ownership check** in `updateAlertStatus` |
| Discard food that has not expired | 401 | **403** | ✔ | business rule in `updateAlertStatus` |
| Change thresholds / email recipients | 401 | **403** | ✔ | `requireRole('admin')` on `PUT /settings` |
| View reports | 401 | ✔ | ✔ | `reportRoutes` |
| See / download / delete **own** exports | 401 | ✔ | ✔ | `exportService.getOwnedExport` |
| See / download / delete **others'** exports | 401 | **403** | ✔ | `exportService.getOwnedExport` + SQL filter in `listExports` |

**Why is 401 different from 403?** 401 = "I don't know who you are". 403 = "I know who you
are and you are not allowed". The brief explicitly checks for the right one.

**Why ownership on alerts?** When a staff member acknowledges an alert they take
responsibility for it. Letting anyone else close it would hide who actually handled the food.

---

## 5. Step 4 — F1: look up items about to expire

`GET /api/alerts/expiry?days=7&category=dairy` → `alertService.getExpiringItems`

1. Read the warning window from `alert_settings` (or use `days` from the query).
2. SQL: items with `quantity > 0` and `expiry_date <= CURRENT_DATE + days`, ordered by
   expiry date (**first-expiry-first-out**: hand these out first).
3. `days_left = expiry_date - CURRENT_DATE` is calculated in SQL.
4. `levelFor(daysLeft)`:
   - `< 0` → **expired**
   - `<= critical_days` (default 2) → **critical**
   - otherwise → **warning**
5. `has_active_alert` tells staff whether the scan has already raised an alert.

**Why compute dates in SQL with `CURRENT_DATE`?** One clock (the database), so the API,
the Lambda and the reports always agree on "today".

---

## 6. Step 5 — F2: the alert scan (the core business logic)

`POST /api/alerts/scan` (button) **and** the daily Lambda → `alertService.runScan`

Inside **one transaction**:

1. `pg_advisory_xact_lock(424242)`. *Why:* if the Lambda and a staff member start a scan at the
   same moment, the second waits. No duplicates, no race condition (threat T5 in the proposal).
2. Load all at-risk items and all currently active alerts.
3. For each at-risk item:
   - same level already alerted → **skip** (no duplicate alerts, no repeat emails)
   - level changed (warning → critical → expired) → close the old alert as `escalated`, create a new one
   - no alert yet → **create** one
4. **Auto-resolve**: an active alert whose item now has quantity 0 (Momen's distribution gave
   it all out) is closed as `stock_cleared`. *This is the integration with the Distribution service.*

**After** the transaction commits:

5. If email is enabled and new alerts were created, send **one digest email** to the configured
   recipients (external integration). *Why after commit?* A slow or failing mail server must not
   roll back the alerts or hold the database lock. If the email fails, the alerts are still saved
   and visible in the app (the fallback promised in the proposal), and the failure is logged and counted.
6. Publish CloudWatch metrics: `ActiveExpiryAlerts`, `NewExpiryAlerts`, `ExpiredItemAlerts`, `AlertEmailFailures`.

**Why one digest and not one email per item?** 30 items expiring would mean 30 emails. Staff
would stop reading them.

---

## 7. Step 6 — F2: acknowledge → resolve workflow

`PATCH /api/alerts/:id` with `{ "status": "acknowledged" }` or
`{ "status": "resolved", "resolution_action": "...", "note": "..." }`

The row is locked with `SELECT ... FOR UPDATE` so two people cannot change it at once. Rules:

| Rule | Result |
|---|---|
| Alert does not exist | 404 |
| Alert already resolved (final state) | 409 |
| Acknowledge something not `open` | 409 |
| Resolve an alert **another staff member** acknowledged | **403** (ownership; admin allowed) |
| Mark **expired** food as `distributed` | 409 (food safety: you cannot give out expired food) |
| Staff marks **non-expired** food as `discarded` | 403 (only admin can throw away good food) |
| `other` without a note | 400 |

**Integration with Inventory (Mohamed's backend):** when an alert is resolved as `discarded` or
`transferred`, Nancy's backend calls `PATCH /api/items/{id} {"quantity": 0}` on Mohamed's service,
forwarding the user's token, *inside* the transaction that locks the alert. Only if that succeeds is
the alert marked resolved (with `resolved_quantity`); if it fails, the transaction rolls back and the user
sees 502. *Why:* the food physically left the building. Without this, the inventory would show food
that is not there, and the next scan would raise the same alert again.
(This was found while testing; see "Difficulties" in the contribution statement.)

---

## 8. Step 7 — F3: reports with filters (`reportService.js`)

All three reports accept `category`, `from`, `to` (validated) and return **totals + rows by category**.

| Report | Data source (service) | Calculation |
|---|---|---|
| Inventory | `food_items` (Mohamed) | stock, expired qty, expiring-soon qty, **% at risk** |
| Distributions | `distributions` + items (Momen) | number of distributions, **distinct families served**, units, top 5 items |
| Waste | `expiry_alerts` (Nancy) | units saved vs wasted vs transferred, **waste rate %** |

Default period for distributions and waste is the last 30 days, and the maximum range is 366 days.
*Why the cap:* one request cannot make the database scan years of history (a denial-of-service guard).

`GET /api/reports/dashboard` combines alert counts, stock totals and the last 7 days for the shared home page.

---

## 9. Step 8 — F4: exports to S3 with ownership (`exportService.js`)

`POST /api/reports/exports` → build detailed rows → CSV → **S3** → row in `saved_reports`

- **The S3 key is generated by the server**: `reports/user-<id>/<type>-<date>-<uuid>.csv`.
  *Why:* the user never chooses where the file goes, so they cannot overwrite someone else's file.
- **CSV injection protection** (`utils/csv.js`): a cell starting with `= + - @` gets a `'` in
  front. *Why:* an item named `=HYPERLINK(...)` would otherwise run as a formula in Excel.
- **Encrypted at rest**: `ServerSideEncryption: 'AES256'`, plus bucket default encryption.
- **Private bucket + pre-signed link valid for 5 minutes** (`GET /exports/:id/download`), only
  after the ownership check. *Why:* nobody can guess a URL to someone else's report.
- **Limit of 20 exports per user** → 409. *Why:* cost control; one account cannot fill the bucket.
- **Family contact details are never exported**, only the household reference. *Why:* data minimisation (threat T3).
- If the database insert fails after the upload, the S3 file is deleted (no orphan files).

---

## 10. Step 9 — The external integration: email (`notifier.js`)

- Uses **nodemailer** with a real SMTP provider (Brevo free tier, Mailtrap, or Gmail with an
  app password). This is a genuine workflow step: the email tells staff which food to hand out first.
- `requireTLS: true`. *Why:* the SMTP password is never sent unencrypted.
- **Credentials live in Secrets Manager** (`foodbank/nancy/smtp`), loaded at startup by
  `aws/secrets.js`. Locally they can come from `.env`, which is git-ignored.
- Item names are HTML-escaped in the email body.

**How to set up Brevo (free):** create an account → SMTP & API → SMTP tab → note the server
(`smtp-relay.brevo.com`, port 587), your login, and generate an SMTP key. Verify a sender email.
Put these values in your shell before running `setup-nancy.sh`. **Never paste them into a file in the repo.**

---

## 11. Step 10 — AWS services on Floci (`infra/floci/setup-nancy.sh`)

The brief needs **at least 3 AWS services in your own component**. Nancy uses seven:

| # | Service | What it does in Nancy's component | Why this service |
|---|---|---|---|
| 0 | **API Gateway** (HTTP API) | public entry point for Nancy's backend only; routes `/api/alerts*`, `/api/reports/*`, `/health` | each backend gets its own URL and can be deployed alone |
| 1 | **S3** | stores report CSVs | cheap file storage; private + encrypted + versioned + 90-day lifecycle |
| 2 | **Secrets Manager** | SMTP credentials and app secrets | no secret in code or Git |
| 3 | **Lambda** | `nancy-alerts-api` runs the Express backend (`serverless-http`); `nancy-expiry-scan` runs the daily scan. One package, two handlers | pay per request; no server to keep on; same code as local |
| 4 | **EventBridge Scheduler** | triggers the Lambda daily at 08:00 Cairo time | staff get alerts without anyone pressing a button |
| 5 | **CloudWatch** (Logs, metrics, alarms) | metric filters for 403s, failed logins, scan failures; alarms | monitoring evidence for the report |
| 6 | **IAM** | least-privilege roles | each part can do only its own job |

**Least privilege (be ready to explain this):** each Lambda has its own role. The API role can only
use objects under `foodbank-reports/reports/*`, read Nancy's two secrets, write its own logs and
publish `FoodBank/Alerts` metrics. The scan Lambda's role can *only*:
- read its two secrets (not all secrets),
- write to its own log group,
- publish metrics in the `FoodBank/Alerts` namespace only.

It **cannot** touch S3, IAM or any other function. The scheduler role can only invoke the scan Lambda.
*Why not give admin access?* If the Lambda were compromised, an admin role would let the
attacker read every secret, delete every bucket and create new users. With least privilege,
the damage is limited to what that one function already does.

### How to run it (on Nancy's laptop)

```bash
# 0. one-time: Docker Desktop + AWS CLI v2 + Node 20+ installed
docker compose -f infra/floci/compose.yaml up -d        # start Floci on :4566

cd services/alerts-reporting-service && npm install && cd ../..
bash infra/floci/build-lambda.sh                         # makes alerts-service.zip

# values typed into THIS terminal only (they go to Secrets Manager, not to files)
export DATABASE_URL='postgresql://alerts_service:...@...neon.tech/...?sslmode=require'   # Nancy's own DB login
export JWT_SECRET='...the same value Momen's auth service uses...'
export INVENTORY_API_URL='...Mohamed's API Gateway URL...'   FRONTEND_ORIGIN='http://localhost:3000'
export SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587 SMTP_USER='...' SMTP_PASS='...' SMTP_FROM='Food Bank <you@example.com>'
bash infra/floci/setup-nancy.sh

aws --endpoint-url http://localhost:4566 lambda invoke --function-name nancy-expiry-scan out.json && cat out.json
curl http://<apiId>.execute-api.localhost.floci.io:4566/health      # the script prints the exact URL
```
Then put that URL as `alerts` in `frontend/js/config.js`.

> **Note:** these scripts were syntax-checked, the Lambda package was built, and both handlers were
> run locally against PostgreSQL (the API handler with API Gateway-shaped events). They could **not**
> be executed against Floci in the environment where they were written (no Docker there). Run them once
> early, and screenshot each step as evidence.

### Run Nancy's backend locally

Follow `services/alerts-reporting-service/README.md`: create the database with `database/` (Neon), start the
backend with the `alerts_service` login, and use `npm run token -- 2 staff` to test the API in Postman until
Momen's login is running. The frontend is static: `npx serve frontend -l 3000`.

---

## 12. Step 11 — Logging and monitoring (`utils/logger.js`)

- Every request logs one JSON line: method, path, status, time, user id, role. **No body, no token.**
- Security events: `AUTH_MISSING_TOKEN`, `AUTH_INVALID_TOKEN`, `ACCESS_DENIED_ROLE`,
  `ACCESS_DENIED_OWNERSHIP`, `LOGIN_FAILED`.
- Business events: `ALERT_SCAN_COMPLETED`, `ALERT_EMAIL_SENT/FAILED`, `STOCK_REMOVED_BY_ALERT`, `REPORT_EXPORTED`...
- `redact()` replaces any key that looks like password, token, secret or authorization with
  `[REDACTED]` and masks emails (`n***@foodbank.org`). *Why:* the brief says logs must not expose sensitive values.

**Monitoring evidence for the report** (after running `setup-nancy.sh`):
1. As staff2, try to download staff1's export 5 times → five 403s.
2. `aws logs filter-log-events --log-group-name /foodbank/api --filter-pattern '{ $.status = 403 }'`
   → screenshot. This is the "suspicious activity" example.
3. `aws cloudwatch describe-alarms --alarm-names foodbank-many-403s` → the alarm goes to `ALARM`.
4. `aws cloudwatch get-metric-statistics --namespace FoodBank/Alerts --metric-name ActiveExpiryAlerts ...` → metric evidence.

---

## 13. Step 12 — Frontend (`frontend/`)

- `js/config.js` + `js/api.js`: one `fetch` wrapper picks the backend by URL prefix (`/api/alerts` →
  Nancy's, `/api/items` → Mohamed's...), adds the token, turns errors into messages, and on **401**
  sends you back to login. The token is kept in `sessionStorage`, so it is gone when the tab is closed.
- `el()` builds HTML with **`textContent` only**, never `innerHTML`. *Why:* item names are typed
  by staff; with `innerHTML` a name like `<img onerror=...>` would run script (stored XSS).
- `alerts.html`: alert table with filters, Acknowledge/Resolve buttons and a resolve dialog,
  the F1 look-up, and settings (read-only for staff).
- `reports.html`: report selector, category and date filters, tiles + table, CSV export, saved exports.
- `nav.js`: shared navigation with the **live alert badge** (refreshes every minute) = notification integration on every page.
- The UI greys out buttons a user cannot use (e.g. Resolve on someone else's alert), but that is
  only for convenience. **The API is what enforces it.** Be ready to prove this in the demo by
  sending the same request from Postman and getting 403.

---

## 14. Step 13 — Tests (`services/alerts-reporting-service/tests/`)

91 automated tests, run against a real PostgreSQL database (S3, email and Mohamed's API are mocked):

- `alerts.test.js`: F1 levels and filters; scan creates, de-duplicates, escalates, auto-resolves;
  one digest email; full workflow; ownership 403; food-safety rules; settings validation;
  discard calls Inventory with the user's token; Inventory down → 502 and the alert stays open.
- `inventoryClient.test.js`: the HTTP call to Mohamed's service and how each of his answers is mapped (404/403/502).
- `reports.test.js`: report calculations; filters; invalid dates; exports; ownership; 20-export limit; CSV injection.
- `security.test.js`: 401 on all 13 endpoints; forged/expired/`alg:none` tokens; unknown role 403;
  malformed JSON; 50 kB body limit; SQL injection in an id; security headers; log redaction;
  **secret exposure scan of the whole repository**.

---

## 15. How to commit this (repository evidence)

**Commit it yourself, in small steps, on your own branch.** The examiner checks that each
student has real commits for their own component, and committing in stages also helps you
understand each part:

```bash
git checkout -b feature/nancy-alerts-reports
git add database && git commit -m "DB: schema for all services, setup/seed/status scripts, least-privilege logins"
git add services/alerts-reporting-service/package*.json services/alerts-reporting-service/.env.example services/alerts-reporting-service/src/db services/alerts-reporting-service/src/config.js \
  && git commit -m "alerts-reporting-service: project setup, config, own migration"
git add services/alerts-reporting-service/src/utils services/alerts-reporting-service/src/aws services/alerts-reporting-service/src/middleware services/alerts-reporting-service/src/constants.js \
  && git commit -m "Validation, safe logger, token verification, S3/Secrets/CloudWatch helpers"
git add services/alerts-reporting-service/src/services/alerts services/alerts-reporting-service/src/clients \
  && git commit -m "Expiry alerts: look-up, scan, workflow, email digest, Inventory API call"
git add services/alerts-reporting-service/src/services/reports && git commit -m "Reports with filters and S3 CSV exports with ownership"
git add services/alerts-reporting-service/src/app.js services/alerts-reporting-service/src/server.js services/alerts-reporting-service/src/lambda \
  && git commit -m "App wiring, Lambda handlers for API and daily scan"
git add infra && git commit -m "Floci: API Gateway, Lambda, scheduler, least-privilege IAM, CloudWatch alarms"
git add frontend && git commit -m "Frontend: all pages, shared nav, per-service API routing"
git add services/alerts-reporting-service/tests services/alerts-reporting-service/scripts && git commit -m "Tests (91) and test-token tool"
git add docs README.md services/*/README.md .gitignore && git commit -m "Docs: guide, API tests, report sections, service contracts"
git push -u origin feature/nancy-alerts-reports      # then open a Pull Request
```

Before pushing: `git status` must **not** show `.env`. Run `npm test` (the secret scan test is included).

**Working with teammates:** share the contracts in `services/inventory-service/README.md` and
`services/distribution-service/README.md` with Mohamed and Momen. Those are the only things your backend
needs from theirs (the stock-update endpoint, the login token format and the shared `JWT_SECRET`).

---

## 16. Questions you are likely to be asked, with short answers

- **"Walk me through what happens when I click *Run expiry scan now*."** → `alerts.js` sends
  `POST /api/alerts/scan` with the token → `requireAuth` (401?) → `requireRole` (403?) →
  controller → `runScan` (lock, compare items with active alerts, create/escalate/auto-resolve,
  commit) → email digest → metrics → `201` + summary → page shows the message and refreshes the table and badge.
- **"What if two scans run at once?"** Advisory lock + partial unique index. No duplicates.
- **"What if the email provider is down?"** Alerts are already committed and visible in the app;
  the failure is logged as `ALERT_EMAIL_FAILED` and counted in `AlertEmailFailures`.
- **"A staff password is stolen. What can the attacker do?"** Only staff actions; not settings and not
  other users' exports. Token expires in 2 hours. Fix: reset the password; rotating `JWT_SECRET`
  in Secrets Manager and restarting the API logs out everyone at once. The 403 and failed-login alarms would show unusual activity.
- **"Someone deletes a report by mistake."** The bucket has versioning, so the file can be restored.
  Data rows: Neon point-in-time restore / branch. Schema: re-run `npm run migrate`. AWS setup:
  re-run `setup-nancy.sh` (infrastructure as a script).
- **"The SMTP password was committed to Git."** Treat it as leaked: rotate it at the provider,
  update the secret, purge it from history. Deleting the file is not enough, because it stays in the commit history.
- **"Mohamed's service is down — what still works?"** Everything in Nancy's service except
  discarding/transferring food (502, the alert stays open). Reports and alerts keep working.
- **"What happens under more load?"** Each backend's Lambda scales on its own; the scan is one indexed query;
  reports are aggregated in SQL (not in JS); the connection pool is capped; exports are capped at 5,000 rows.
- **"Why is this not just CRUD?"** Severity calculation, de-duplication, escalation, workflow with
  ownership, food-safety rules, auto-resolve and stock removal (cross-service), waste rate and at-risk percentages.
- **"Why does the frontend hide the settings form from staff if the API blocks it anyway?"**
  Usability only. Show Postman getting 403 to prove the backend enforces it.
