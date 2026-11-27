# alerts-reporting-service — Nancy

Expiry Alerts & Reporting, as its own backend. Port **3003** locally; deployed as its own
Lambda behind its own API Gateway on Floci.

## Run it

1. Create the database first: `database/README.md` (Neon, all tables, demo data, the `alerts_service` login).
2. Configure and start:
```powershell
cd services\alerts-reporting-service
npm install
copy .env.example .env      # DATABASE_URL = the alerts_service login, JWT_SECRET = same as Momen's service
npm start                   # http://localhost:3003/health
```
Do not run `npm run migrate` on Neon: the tables are created once by `database/` setup, and the
`alerts_service` login is deliberately not allowed to create tables.

3. Test the API before Momen's login exists (Postman / `docs/nancy/requests.http`):
```powershell
npm run token -- 2 staff     # prints a token for Staff One (user 2 after the database seed)
npm run token -- 1 admin
```
This only signs a token with your own `JWT_SECRET`, the same way Momen's login will. It is a test tool
and refuses to run in production.

4. Automated tests (91): they wipe the database they use, so use a **Neon test branch**, never the main one:
```powershell
$env:TEST_DATABASE_URL = "<test branch connection string>"; npm test
```

## Deploy on Floci (Windows, PowerShell)

1. Docker Desktop running ("Engine running").
2. Start Floci (from the project folder):
   ```powershell
   cd $HOME\Documents\foodbank\infra\floci
   docker compose up -d
   ```
3. Create all AWS resources and deploy the Lambdas (reads your `.env`, prints no secrets, safe to re-run):
   ```powershell
   cd $HOME\Documents\foodbank\services\alerts-reporting-service
   npm.cmd install
   npm.cmd run floci:deploy
   npm.cmd run floci:check
   ```
   Creates: S3 bucket (private, encrypted, versioned), 2 Secrets Manager secrets, 3 IAM roles (least privilege),
   CloudWatch log groups + metric filters + 4 alarms, 2 Lambda functions, the daily EventBridge schedule,
   and an API Gateway HTTP API (its URL is printed at the end).
4. In `.env` set `CW_LOG_GROUP=/foodbank/api` and `CW_METRICS_ENABLED=true`, restart the backend, then `npm.cmd run smoke`
   (the S3 export check should now PASS).

Without Docker you can still run `npm.cmd run floci:setup` (no `--with-lambda`) against the Floci Windows binary.

## Deploy on Vercel (public demo)

Create a Vercel project with **Root Directory** `services/alerts-reporting-service`, then set these
environment variables in the Vercel dashboard (never in the repo): `DATABASE_URL` (alerts_service login),
`JWT_SECRET` (the shared one, 32+ characters), `CORS_ORIGIN` (the frontend URL), `INVENTORY_API_URL`
(the deployed inventory service). Email needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
CSV exports to S3 and CloudWatch metrics only work in the Floci/AWS deployment, not on Vercel.
