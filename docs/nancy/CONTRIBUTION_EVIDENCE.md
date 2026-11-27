# Nancy: repository evidence for the owned component

Owned component: **Expiry Alerts & Reporting** (`services/alerts-reporting-service`) plus its frontend pages, Floci deployment and
Vercel deployment. Report and database lead.

## Where my work is

| Area | Files |
|---|---|
| Backend / API (4 functions: expiry look-up, alert scan and workflow, reports, CSV exports) | `services/alerts-reporting-service/src/**` |
| Data | `services/alerts-reporting-service/src/db/**`; tables `expiry_alerts`, `alert_settings`, `saved_reports` |
| Frontend | `frontend/alerts.html`, `frontend/reports.html`, `frontend/js/alerts.js`, `frontend/js/reports.js` |
| Tests | `services/alerts-reporting-service/tests/**` (Jest), `scripts/smoke-test.js`, `scripts/floci-check.js` |
| Floci deployment | `infra/floci/setup-nancy.sh`, `build-lambda.sh`, `compose.yaml`, `policies/`, `scripts/floci-setup.js` |
| Vercel deployment | `services/alerts-reporting-service/api/index.js`, `vercel.json` |
| Documentation | `docs/nancy/**` |

Code ownership is declared in `.github/CODEOWNERS`.

## Pull requests and commits

| PR | What |
|---|---|
| #5 | Alerts-reporting-service Floci deployment, smoke test and docs |
| #6 | Vercel deployment of the alerts service |
| #7, #9, #12-#15 | Floci deployment scripts for the whole stack (timeouts, Windows paths, recreate Lambdas) |
| #22 | Floci deployment files into the shared branch |

Commit history: `git log --author="Nancy" -- services/alerts-reporting-service docs/nancy infra/floci`.

**Note on the first commit:** the initial import of the shared starter files, including the first version of the alerts service, frontend pages
and `docs/nancy`, was pushed by Mohamed's account in PR #1 (commit `22bc3e1`, 2026-11-22). Those files are the alerts-reporting work; the
later commits above are made from my account. This is stated here so the history can be read correctly.

## Integration with the other services

- Verifies the JWT issued by the distribution/login service (same secret).
- Reads inventory and distribution data through a read-only database login.
- Calls the inventory service `PATCH /api/items/:id` (forwarding the user's token) when food is discarded or transferred.
- Shared frontend navigation and `config.js` route table.
