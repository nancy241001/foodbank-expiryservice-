# Food Bank: Expiry Alerts & Reporting service

Nancy Mohamed (241001), Group 36, Cloud Computing and Cloud Security.

- `services/alerts-reporting-service/` backend (15 endpoints, tests, Lambda handlers, Vercel entry `api/index.js`)
- `frontend/` alerts and reports pages plus the shared login, navigation and API files they need
- `infra/floci/setup-nancy.sh` Floci deployment (API Gateway, Lambda, S3, Secrets Manager, IAM, CloudWatch, EventBridge)
- `database/` schema, roles and seed used by this service
- `docs/nancy/` guide, Floci test, report sections, deployment/cost/recovery/limitations, contribution evidence
- Vercel demo: https://foodbank-alerts.vercel.app (`/health`)
- Team repository (all three services): https://github.com/nancy241001/cloud-project-food-bank-

No secrets are stored here: copy `.env.example` to `.env` locally.
