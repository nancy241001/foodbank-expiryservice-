# Report material — Nancy (Expiry Alerts & Reporting, Report & Threat Model lead)

Copy these into the final report. Replace every **[SCREENSHOT]** with your own evidence taken from
the **deployed** app (the brief requires evidence from the deployed system, not only local tests).

---

## A. Service/API list — Expiry Alerts & Reporting (report section 3)

Separate backend: `alerts-reporting-service`, deployed as Lambda `nancy-alerts-api` behind its own API Gateway.
All endpoints require `Authorization: Bearer <token>` (issued by the auth service, verified here). Missing or invalid token → **401**; wrong role → **403**.

| # | Method | Endpoint | Function | Validates | Success | Errors | Roles |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/alerts/expiry` | F1 look up items about to expire | `days` 1–90 integer; `category` in list | 200 | 400, 401, 403, 500 | Staff, Admin |
| 2 | POST | `/api/alerts/scan` | F2 create / escalate / auto-resolve alerts, email digest | empty body only | 201 | 400, 401, 403, 500 | Staff, Admin |
| 3 | GET | `/api/alerts` | F2 view alerts | `status`, `level`, `category` in lists | 200 | 400, 401, 403 | Staff, Admin |
| 4 | PATCH | `/api/alerts/:id` | F2 acknowledge / resolve (discard/transfer → calls Inventory API) | id positive int; `status`; `resolution_action`; `note` ≤300; no extra fields; workflow + ownership + food-safety rules | 200 | 400, 401, 403, 404, 409, 502 | Staff (own), Admin |
| 5 | GET | `/api/alerts/summary` | nav badge counts | – | 200 | 401, 403 | Staff, Admin |
| 6 | GET | `/api/alerts/settings` | view thresholds | – | 200 | 401, 403 | Staff, Admin |
| 7 | PUT | `/api/alerts/settings` | change thresholds and recipients | all 4 fields; 1–90; 0–30; critical < warning; valid emails ≤10 | 200 | 400, 401, 403 | **Admin** |
| 8 | GET | `/api/reports/inventory` | F3 inventory summary | `category`; `from`/`to` real dates, from ≤ to, ≤366 days | 200 | 400, 401, 403 | Staff, Admin |
| 9 | GET | `/api/reports/distributions` | F3 distribution summary | same | 200 | 400, 401, 403 | Staff, Admin |
| 10 | GET | `/api/reports/waste` | F3 waste vs saved | same | 200 | 400, 401, 403 | Staff, Admin |
| 11 | GET | `/api/reports/dashboard` | dashboard tiles | – | 200 | 401, 403 | Staff, Admin |
| 12 | POST | `/api/reports/exports` | F4 export CSV to S3 | `type` in list + filters; no extra fields; ≤20 per user | 201 | 400, 401, 403, 409 | Staff, Admin |
| 13 | GET | `/api/reports/exports` | F4 list exports | – (own only for staff) | 200 | 401, 403 | Staff (own), Admin (all) |
| 14 | GET | `/api/reports/exports/:id/download` | F4 5-minute download link | id; ownership | 200 | 400, 401, 403, 404 | Owner, Admin |
| 15 | DELETE | `/api/reports/exports/:id` | F4 delete export (S3 + row) | id; ownership | 204 | 400, 401, 403, 404 | Owner, Admin |

**Connections to other services (not CRUD-only):** verifies tokens issued by the auth service; reads
Inventory (`food_items`) and Distribution (`distributions`, `distribution_items`) through a read-only DB
login; auto-resolves alerts when Distribution brings stock to 0; calls Inventory's
`PATCH /api/items/{id}` (forwarding the user's token) to set stock to 0 when food is discarded/transferred.

**Data operations used by this service:**

| Entity | C | R | U | D | Query/search |
|---|---|---|---|---|---|
| `expiry_alerts` | scan | list, summary, reports | acknowledge, resolve, escalate, auto-resolve | cascade with item | by status / level / category / date |
| `alert_settings` | seeded | GET settings | PUT settings | – | – |
| `saved_reports` | export | list (own/all) | – | delete export | by owner |
| `food_items` (Mohamed) | – | look-up, scan, reports | via Mohamed's API only (quantity → 0) | – | by expiry window, category, donation date |
| `distributions*` (Momen) | – | distribution report, CSV | – | – | by date range, category |

ER relationships to draw: `food_items 1—* expiry_alerts`; `users 1—* expiry_alerts` (acknowledged_by, resolved_by);
`users 1—* saved_reports`; `families 1—* distributions 1—* distribution_items *—1 food_items`; `users 1—* distributions`.

---

## B. Threat model (report section 7) — whole application, mapped to implemented controls

| # | Threat | Category | Affected part | Implemented control (where) | Test |
|---|---|---|---|---|---|
| T1 | Stolen or guessed staff credentials | Identity | login, all APIs | bcrypt hashes; JWT HS256 with 2-hour expiry; `LOGIN_FAILED` log + `FailedLogins` metric filter | ST-03, monitoring |
| T2 | Forged token or role bypass (e.g. `alg:none`, staff calling admin route) | Identity / API | backend routes | `requireAuth` verifies signature with HS256 only; `requireRole` on every route; admin-only settings | ST-02, ST-04 |
| T3 | IDOR: staff reads, downloads or deletes another user's export, or closes another user's alert | Data / API | exports, alerts | ownership check in `exportService.getOwnedExport` and `updateAlertStatus`; server-generated S3 keys; private bucket + 5-min pre-signed links | ST-05, ST-06 |
| T4 | Injection: SQL in filters/ids, XSS via item names, CSV formula injection in exports | Application | API, frontend, CSV | parameterised queries; strict validators; `textContent`-only rendering + CSP (helmet); CSV cell escaping | ST-07, ST-08, ST-09 |
| T5 | Duplicate alerts / wrong stock from concurrent scans or resolves | Application / Data | scan, workflow | transaction + advisory lock; partial unique index; `SELECT ... FOR UPDATE` | automated tests |
| T6 | Secret leak (DB URL, JWT secret, SMTP password) in repo or logs | Cloud config | repo, logs | Secrets Manager; `.env` git-ignored; `.env.example` only; log redaction; repo secret-scan test | ST-10, ST-11 |
| T7 | Over-privileged cloud or database identity (a compromised service can do anything) | Cloud config / Data | Lambdas, scheduler, DB logins | one IAM role per Lambda scoped to its secrets, log group, metric namespace and bucket prefix; one DB login per backend (`database/roles.sql`): Nancy's is read-only on others' tables and cannot read password hashes | ST-12, ST-16 |
| T10 | A failing or slow neighbour service corrupts state or hangs requests | Application | Nancy ↔ Inventory | 5 s timeout; inventory call inside the alert transaction, so failure rolls back (502, alert stays open); `InventoryCallFailures` metric | automated |
| T8 | Public bucket / data exposure of reports or family data | Cloud config / Data | S3, exports | Block Public Access; SSE-AES256; versioning; lifecycle; no family contact data in exports; TLS to Neon | ST-13 |
| T9 | Resource exhaustion (huge bodies, year-long queries, export spam) | Application / Cost | API, S3 | 50 kB body limit; 366-day range cap; 5,000-row export cap; 20 exports per user; log retention 14 days | ST-14 |

---

## C. Security test table — Nancy's component (report section 12)

"Automated" = verified by `npm test` (91 passing). Repeat each one against the **deployed** URL with
Postman/REST Client (`docs/nancy/requests.http`) and add the screenshot.

| ID | Scenario | Expected | Actual | Pass/Fail | Evidence |
|---|---|---|---|---|---|
| ST-01 | Call all 13 alert/report endpoints with no token | 401 on every one | 401 on every one (automated) | Pass | [SCREENSHOT] Postman `GET /api/alerts` → 401 |
| ST-02 | Token signed with a wrong secret / expired token / `alg:none` token claiming admin | 401 | 401 (automated) | Pass | [SCREENSHOT] |
| ST-03 | Wrong password at login | 401 + `LOGIN_FAILED` log, no password in log | as expected | Pass | [SCREENSHOT] response + CloudWatch log line |
| ST-04 | Staff sends `PUT /api/alerts/settings` (unauthorized role) | 403 + `ACCESS_DENIED_ROLE` log | 403 (automated) | Pass | [SCREENSHOT] |
| ST-05 | Staff2 downloads / deletes Staff1's export by changing the id (ownership) | 403, file untouched | 403, `deleteReport` never called (automated) | Pass | [SCREENSHOT] |
| ST-06 | Staff2 resolves an alert acknowledged by Staff1 (ownership) | 403 | 403 (automated) | Pass | [SCREENSHOT] |
| ST-07 | Invalid input: `days=500`, `from=2026-02-31`, `from` after `to`, `type=salaries`, extra field `s3_key` | 400 with clear message | 400 (automated) | Pass | [SCREENSHOT] |
| ST-08 | SQL injection: `category=dairy' OR 1=1--`, `/api/alerts/1 OR 1=1` | 400, nothing reaches the DB | 400 (automated) | Pass | [SCREENSHOT] |
| ST-09 | Item named `=HYPERLINK("http://evil")` exported to CSV | cell prefixed with `'` | prefixed (automated) | Pass | [SCREENSHOT] CSV opened in Excel |
| ST-10 | Secret exposure review: scan repo + `git log -p` for keys, passwords, connection strings | nothing found; `.env` ignored | none found (automated scan) | Pass | [SCREENSHOT] test output + `git ls-files` |
| ST-11 | Logs contain no password/token/full email | redacted / masked | redacted (automated) | Pass | [SCREENSHOT] CloudWatch log line |
| ST-12 | Lambda role tries something outside its policy (e.g. `s3:ListBucket`) | AccessDenied | *run on Floci* | | [SCREENSHOT] `aws iam simulate-principal-policy` or the denied call |
| ST-13 | Open the S3 object URL without a signature | 403 AccessDenied | *run on Floci* | | [SCREENSHOT] |
| ST-14 | 60 kB JSON body; malformed JSON | 413; 400 with no stack trace | 413 / 400 (automated) | Pass | [SCREENSHOT] |
| ST-15 | Business rules: expired food marked `distributed`; staff discards non-expired food | 409; 403 | 409; 403 (automated) | Pass | [SCREENSHOT] |
| ST-16 | Connect with Nancy's DB login and run `UPDATE food_items SET quantity = 999` and `SELECT password_hash FROM users` | permission denied for both | *run on Neon* | | [SCREENSHOT] Neon SQL editor |

> Fill ST-12 and ST-13 only after running them yourself on Floci. Do not mark a test Pass that you have not run.

---

## D. Monitoring evidence plan (report section 11)

1. **Log query**: `/foodbank/api` filtered by `{ $.status = 403 }` after running ST-05 five times → shows repeated forbidden attempts from one user id (suspicious activity).
2. **Metric**: `FoodBank/Security AccessDenied403` (from the metric filter) and `FoodBank/Alerts ActiveExpiryAlerts` (published by every scan).
3. **Alarm**: `foodbank-many-403s` changes to `ALARM` after 5 forbidden requests in 5 minutes; `foodbank-expiry-scan-failed` fires if the daily Lambda fails.
4. Explain: no tokens, passwords or full emails appear (redaction).

---

## E. Individual Contribution Statement — Nancy Mohamed (241001)  *(draft: edit into your own words)*

**Owned component:** Expiry Alerts & Reporting (its own backend, `alerts-reporting-service`). **Shared leads:** database setup; report and threat model.

**Functions implemented:**
(1) look up items about to expire with severity levels; (2) expiry alerts: scheduled/manual scan with
de-duplication, escalation and auto-resolve, an acknowledge → resolve workflow with ownership and
food-safety rules, and an email digest; (3) inventory, distribution and waste reports filtered by category
and date; (4) CSV exports stored in S3 with per-user ownership.

**Frontend:** `alerts.html` (alert table, filters, resolve dialog, look-up, admin settings),
`reports.html` (report selector, filters, tiles, export list), dashboard tiles, navigation alert badge.
All data comes from the API; all rendering uses `textContent`. [SCREENSHOTS]

**Backend/API:** my own backend (`services/alerts-reporting-service`, separate from my teammates'), with 15
endpoints (routes → controllers → services), server-side validation, correct status codes
(200/201/204/400/401/403/404/409/413/502), a central error handler, and an HTTP client for the inventory-service.

**Data operations:** designed the shared schema (8 tables, constraints, indexes, partial unique index);
create/read/update on `expiry_alerts`, read/update on `alert_settings`, create/read/delete on `saved_reports`,
aggregate queries over Inventory and Distribution tables; transactions with locks.

**Security controls:** JWT authentication and role checks on every route; ownership checks on alerts and
exports; input validation and mass-assignment protection; parameterised SQL; CSV-injection and XSS
protection; private encrypted S3 with pre-signed links; secrets in Secrets Manager; least-privilege IAM
roles; log redaction.

**Cloud (Floci):** API Gateway (my backend's own HTTP API), Lambda (API + daily scan), S3, Secrets Manager,
EventBridge Scheduler, CloudWatch (logs, metric filters, alarms) and IAM, all created by
`infra/floci/setup-nancy.sh`. [SCREENSHOTS]

**Tests:** 91 automated Jest/Supertest tests (functional, invalid and security) against PostgreSQL, plus
manual Postman tests against the deployed app. [SCREENSHOT of test run]

**Integration:** verifies tokens from the shared login; shared navigation; reads Mohamed's inventory and
Momen's distributions (read-only DB login); auto-resolves alerts when stock reaches 0; calls Mohamed's
API to set stock to 0 when food is discarded or transferred; dashboard and badge used on every page.

**Important technical decisions:** a separate backend that writes only its own tables and changes other
services' data only through their APIs; business logic in services so the API and Lambda share one `runScan`;
one digest email after the transaction commits; S3 for files and Postgres for metadata; DATE parsed as
text to avoid timezone shifts; one scan at a time with an advisory lock.

**Difficulties and how they were solved:**
- Risk of expiry dates shifting by one day, because `pg` converts DATE columns to local-midnight Date objects (Cairo is UTC+2). Prevented by parsing DATE as plain text.
- Discarded items were re-alerted on the next scan because stock was unchanged. Solved by asking the inventory-service to set the stock to 0 before the alert is resolved, recording `resolved_quantity`, and rolling back if that call fails.
- Splitting into separate backends: login and cross-service writes needed new designs (verify-only JWT middleware, an HTTP client with timeout, read-only DB login, dev stand-ins to test before teammates' services were ready).
- Risk of duplicate alerts when the scheduled and manual scans overlap. Solved by an advisory lock plus a partial unique index.
- *(add your own, e.g. Floci/Docker setup issues you hit)*

**Repository evidence:** branch `feature/nancy-alerts-reports`, commits [links], PR [link].
