# Nancy: Alerts & Reporting service tests on Floci

Scope: only the alerts and reporting service, deployed as a Lambda behind an API Gateway HTTP API on Floci
(`npm run floci:deploy`). Run date: 2026-11-26.

| Test | Result |
|---|---|
| `GET /health` on the Floci API address | 200, `alerts-reporting-service`, status ok |
| Login (admin and two staff) through the Floci login service, token used on the alerts API | 200, token accepted (shared HS256 secret) |
| `GET /api/alerts/summary` with a valid token | 200 |
| `POST /api/alerts/scan` (alerts Lambda calls the inventory Lambda on Floci) | 201, scan ran, new alerts created |
| `PUT /api/alerts/settings` email on, recipient set | stored, read back with `GET /api/alerts/settings` |
| Scan after adding one item that expires tomorrow | 3 alerts created, `email: { sent: true }` (Brevo SMTP) |
| Calls without a token | 401 "Authentication required" |

Scripts in `services/alerts-reporting-service/scripts`: `smoke-test.js` (`npm run smoke`), `floci-check.js` (`npm run floci:check`),
`floci-setup.js` (`npm run floci:setup` and `floci:deploy`).

Notes: an email is only sent when a scan creates a new alert, so "0 new" shows `email disabled` even when email is on.
CSV export to S3 and CloudWatch metrics are Floci-only features.

## Vercel (alerts service only)
`api/index.js`, `vercel.json` and the README section deploy this service on Vercel (Root Directory
`services/alerts-reporting-service`). Live check: `/health` returns ok. CSV exports to S3 and CloudWatch do not run on Vercel.
