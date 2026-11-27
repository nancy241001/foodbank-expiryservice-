# Nancy: Expiry Alerts & Reporting - deployment, cost, recovery, limitations

Covers report sections 6, 14, 15 and 16 for the alerts-reporting-service. Everything below describes what is implemented in this
repository; nothing here is a plan that was not built.

## 6. Deployment approach (this service)

**Model:** serverless on Floci (local AWS emulator, Docker). Two Lambda functions and one HTTP API; the database is an external managed
PostgreSQL (Neon). A second, minimal public deployment of the same Express app runs on Vercel.

| Layer | Floci (main deployment) | Vercel (extra public demo) |
|---|---|---|
| API | API Gateway HTTP API `nancy-alerts-reporting-api` -> Lambda `nancy-alerts-api` (Express through `serverless-http`) | `api/index.js` + `vercel.json`, same Express app |
| Scheduled scan | EventBridge Scheduler `nancy-daily-expiry-scan` -> Lambda `nancy-expiry-scan` | not available |
| Exports | S3 bucket `foodbank-reports` (private, encrypted, versioned, lifecycle) | not available |
| Secrets | Secrets Manager `foodbank/nancy/app`, `foodbank/nancy/smtp` | Vercel environment variables |
| Logs / metrics | CloudWatch log groups, metric filters, alarms | Vercel function logs |
| Identity | IAM role per Lambda, least privilege (`infra/floci/policies/`) | n/a |
| Data | Neon PostgreSQL, own login `alerts_service` (read-only on other services' tables) | same database |

AWS services used by this component on Floci: API Gateway, Lambda, S3, Secrets Manager, IAM, CloudWatch (Logs, metric filters, alarms),
EventBridge Scheduler (8 service features, more than the 3 required).

**Why serverless:** the load is a few staff users and one daily scan, so paying for an always-on server is wasteful; Lambda scales to zero
and each student can deploy their part independently. **Trade-offs:** cold starts (the first request after a deploy takes seconds), a database connection pool (5) per warm Lambda (limited on Neon's free tier), more configuration (URLs and secrets per service), and Floci
behaves like but is not real AWS.

**Deployed URLs:** Vercel `https://foodbank-alerts.vercel.app` (health check: `/health`). Floci API address
`http://<api-id>.execute-api.localhost.floci.io:4566`; the id changes each time the Lambda is recreated, so use the id printed by
`npm run floci:deploy` (steps in `services/alerts-reporting-service/README.md`).

## 14. Cost and resource statement

- Resources used: two Lambda functions (256 MB, 30 s timeout), one HTTP API, one S3 bucket, two secrets, three log groups, one daily schedule,
  one small Neon database (free tier), Brevo SMTP (free tier), Vercel hobby plan.
- Avoiding waste: serverless (no idle compute); log retention 14 days; S3 lifecycle expiry on exports; export limits (5,000 rows per file, 20 exports
  per user); report date range capped at 366 days; request body capped at 50 kB; database pool capped at 5 connections.
- More load (coursework scale): Lambda concurrency scales automatically; the limit to watch is Neon connections, which the small pool size keeps low;
  reports use indexed filters and row limits, which is enough at this size.
- On Floci nothing is billed; the same design on real AWS would stay inside the free tier at coursework traffic.

## 15. Recovery approach

| What is lost | How it is recreated |
|---|---|
| Lambdas, API, bucket, secrets, IAM, schedule, alarms | everything is created by scripts: `npm run floci:deploy` (`scripts/floci-setup.js`, `infra/floci/setup-nancy.sh`); re-run after wiping Floci |
| Application code | Git history on GitHub |
| Database schema and demo data | `database/neon-setup.sql`, `roles.sql`, `neon-seed.sql` (re-run on an empty Neon branch); Neon keeps point-in-time history for restoring a branch |
| Exported CSV files | disposable: regenerate from the database; S3 versioning keeps previous versions of the same key |
| Secrets compromised | create new values in Neon / Brevo / Secrets Manager, update the secret, redeploy; tokens expire after 2 hours |
| Misconfiguration | scripts are idempotent and committed; redeploy restores the intended configuration |

## 16. Limitations (residual risks and what was not done)

| Limitation | Reason | Proposed improvement |
|---|---|---|
| Floci is an emulator: IAM and some CloudWatch features are not enforced exactly like AWS | brief allows an AWS emulator | run the same scripts on a real AWS account |
| One shared HS256 JWT secret across the three services | simplest way to share login between separate backends | asymmetric keys (RS256): the login service signs, others only verify |
| Passwords/tokens are not rotated automatically | out of coursework scale | scheduled rotation in Secrets Manager |
| An email is sent only when a scan creates a new alert (not for existing ones) | avoids daily duplicate emails | add a daily digest of all open alerts |
| Vercel deployment has no S3 exports, CloudWatch metrics or scheduled scan | those are AWS features | keep Floci/AWS as the full deployment |
| No automated end-to-end browser tests | time | add Playwright tests against the deployed frontend |
| No application-level rate limiting in this service | not implemented in the time available | API Gateway throttling or a rate limiter in Express |
