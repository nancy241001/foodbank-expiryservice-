#!/usr/bin/env bash
# =====================================================================
# Nancy - alerts-reporting-service: its OWN backend and AWS resources on Floci
# AWS services used by this component:
#   1. API Gateway (HTTP API) public HTTPS entry point for Nancy's backend only
#   2. Lambda                 nancy-alerts-api (the Express backend) + nancy-expiry-scan (daily scan)
#   3. S3                     private, encrypted bucket for report exports
#   4. Secrets Manager        SMTP credentials (+ shared JWT secret and this service's DB URL)
#   5. IAM                    least-privilege roles for each Lambda and the scheduler
#   6. EventBridge Scheduler  triggers the scan every morning
#   7. CloudWatch             log groups, metric filters and alarms (monitoring evidence)
#
# Before running:
#   docker compose -f infra/floci/compose.yaml up -d
#   bash infra/floci/build-lambda.sh
#   export DATABASE_URL=... (alerts_service login)  JWT_SECRET=... (same as Momen's auth)
#   export INVENTORY_API_URL=... (Mohamed's API URL)  FRONTEND_ORIGIN=... (where the frontend is served)
#   export SMTP_HOST=... SMTP_USER=... SMTP_PASS=... SMTP_FROM=...
# Values are read from YOUR shell; nothing secret is stored in this file.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}" AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
BUCKET=foodbank-reports
FN=nancy-expiry-scan
API_FN=nancy-alerts-api
ZIP=alerts-service.zip
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:3000}"
INVENTORY_API_URL="${INVENTORY_API_URL:-http://host.docker.internal:3001}"
ACCOUNT=000000000000

: "${DATABASE_URL:?export DATABASE_URL first}" "${JWT_SECRET:?export JWT_SECRET first}"
: "${SMTP_HOST:?export SMTP_HOST first}" "${SMTP_USER:?export SMTP_USER first}" "${SMTP_PASS:?export SMTP_PASS first}"

step() { echo; echo "==> $*"; }

# ---------------------------------------------------------------- 1. S3
step "S3: private, encrypted bucket for report exports"
aws s3api create-bucket --bucket "$BUCKET" >/dev/null 2>&1 || echo "bucket already exists"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled   # recovery from accidental delete
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-old-exports","Status":"Enabled","Filter":{"Prefix":"reports/"},"Expiration":{"Days":90},"NoncurrentVersionExpiration":{"NoncurrentDays":30}}]}'
# The browser downloads with a pre-signed link, so only the frontend origin may GET.
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration \
  "{\"CORSRules\":[{\"AllowedOrigins\":[\"${FRONTEND_ORIGIN}\"],\"AllowedMethods\":[\"GET\"],\"AllowedHeaders\":[\"*\"],\"MaxAgeSeconds\":300}]}"

# ---------------------------------------------------------------- 2. Secrets Manager
step "Secrets Manager: this service's secrets + SMTP (values from your shell)"
put_secret() {
  local id="$1" value="$2"
  if aws secretsmanager describe-secret --secret-id "$id" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --secret-id "$id" --secret-string "$value" >/dev/null
  else
    aws secretsmanager create-secret --name "$id" --secret-string "$value" >/dev/null
  fi
  echo "stored $id"
}
APP_JSON=$(node -e 'console.log(JSON.stringify({DATABASE_URL:process.env.DATABASE_URL,JWT_SECRET:process.env.JWT_SECRET}))')
SMTP_JSON=$(node -e 'const e=process.env;console.log(JSON.stringify({SMTP_HOST:e.SMTP_HOST,SMTP_PORT:e.SMTP_PORT||"587",SMTP_USER:e.SMTP_USER,SMTP_PASS:e.SMTP_PASS,SMTP_FROM:e.SMTP_FROM||""}))')
put_secret foodbank/nancy/app "$APP_JSON"
put_secret foodbank/nancy/smtp "$SMTP_JSON"
unset APP_JSON SMTP_JSON

# ---------------------------------------------------------------- 3. IAM (least privilege)
step "IAM: roles with only the permissions each part needs"
aws iam create-role --role-name nancy-expiry-scan-role --assume-role-policy-document file://policies/lambda-trust.json >/dev/null 2>&1 || true
aws iam put-role-policy --role-name nancy-expiry-scan-role --policy-name expiry-scan-least-privilege \
  --policy-document file://policies/expiry-scan-lambda-policy.json
aws iam create-role --role-name nancy-scheduler-role --assume-role-policy-document file://policies/scheduler-trust.json >/dev/null 2>&1 || true
aws iam put-role-policy --role-name nancy-scheduler-role --policy-name invoke-expiry-scan-only --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"arn:aws:lambda:${AWS_DEFAULT_REGION}:${ACCOUNT}:function:${FN}\"}]}"
aws iam create-role --role-name nancy-alerts-api-role --assume-role-policy-document file://policies/lambda-trust.json >/dev/null 2>&1 || true
aws iam put-role-policy --role-name nancy-alerts-api-role --policy-name alerts-api-least-privilege \
  --policy-document file://policies/api-reports-policy.json

# ---------------------------------------------------------------- 4. Lambda (two functions, one package)
step "Lambda: nancy-alerts-api (the backend) and nancy-expiry-scan (daily job)"
[ -f "$ZIP" ] || { echo "run build-lambda.sh first"; exit 1; }
deploy_fn() { # name handler role env
  if aws lambda get-function --function-name "$1" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$1" --zip-file "fileb://$ZIP" >/dev/null
    aws lambda wait function-updated --function-name "$1" 2>/dev/null || sleep 2
    aws lambda update-function-configuration --function-name "$1" --environment "$4" >/dev/null
  else
    aws lambda create-function --function-name "$1" --runtime nodejs22.x --handler "$2" --zip-file "fileb://$ZIP" \
      --role "arn:aws:iam::${ACCOUNT}:role/$3" --timeout 30 --memory-size 256 --environment "$4" >/dev/null
  fi
  echo "function $1 ready"
}
COMMON="USE_SECRETS_MANAGER=true,APP_SECRET_ID=foodbank/nancy/app,SMTP_SECRET_ID=foodbank/nancy/smtp,CW_METRICS_ENABLED=true,NODE_ENV=production"
deploy_fn "$API_FN" src/lambda/apiHandler.handler nancy-alerts-api-role \
  "Variables={$COMMON,REPORTS_BUCKET=$BUCKET,CORS_ORIGIN=$FRONTEND_ORIGIN,INVENTORY_API_URL=$INVENTORY_API_URL}"
deploy_fn "$FN" src/lambda/expiryScanHandler.handler nancy-expiry-scan-role "Variables={$COMMON}"

# ---------------------------------------------------------------- 4b. API Gateway
step "API Gateway: HTTP API in front of Nancy's backend only"
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='nancy-alerts-reporting-api'].ApiId | [0]" --output text)
if [ "$API_ID" = "None" ] || [ -z "$API_ID" ]; then
  API_ID=$(aws apigatewayv2 create-api --name nancy-alerts-reporting-api --protocol-type HTTP --query ApiId --output text)
  INTEG=$(aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY --payload-format-version 2.0 \
    --integration-uri "arn:aws:lambda:${AWS_DEFAULT_REGION}:${ACCOUNT}:function:${API_FN}" --query IntegrationId --output text)
  # Only Nancy's paths are routed to her Lambda; anything else gets API Gateway's 404.
  for R in "ANY /api/alerts" "ANY /api/alerts/{proxy+}" "ANY /api/reports/{proxy+}" "GET /health" "OPTIONS /{proxy+}"; do
    aws apigatewayv2 create-route --api-id "$API_ID" --route-key "$R" --target "integrations/$INTEG" >/dev/null
  done
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null
  aws lambda add-permission --function-name "$API_FN" --statement-id apigw-invoke --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:${AWS_DEFAULT_REGION}:${ACCOUNT}:${API_ID}/*" >/dev/null
fi
API_URL="http://${API_ID}.execute-api.localhost.floci.io:4566"
echo "Nancy's API: $API_URL   (put this as 'alerts' in frontend/js/config.js)"

# ---------------------------------------------------------------- 5. EventBridge Scheduler
step "EventBridge Scheduler: run the scan every day at 08:00 Cairo time"
aws scheduler delete-schedule --name nancy-daily-expiry-scan >/dev/null 2>&1 || true
aws scheduler create-schedule --name nancy-daily-expiry-scan \
  --schedule-expression "cron(0 8 * * ? *)" --schedule-expression-timezone "Africa/Cairo" \
  --flexible-time-window Mode=OFF \
  --target "{\"Arn\":\"arn:aws:lambda:${AWS_DEFAULT_REGION}:${ACCOUNT}:function:${FN}\",\"RoleArn\":\"arn:aws:iam::${ACCOUNT}:role/nancy-scheduler-role\",\"Input\":\"{}\"}" >/dev/null
echo "schedule created"

# ---------------------------------------------------------------- 6. CloudWatch
step "CloudWatch: log groups, metric filters and alarms"
for G in /foodbank/api "/aws/lambda/${API_FN}" "/aws/lambda/${FN}"; do
  aws logs create-log-group --log-group-name "$G" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "$G" --retention-in-days 14   # cost control
done
# Counts every 403 (role or ownership refusal) - a spike can mean someone is probing other users' data.
# Applied to the Lambda's log group (deployed) and /foodbank/api (when the backend runs locally against Floci).
for G in "/aws/lambda/${API_FN}" /foodbank/api; do
  aws logs put-metric-filter --log-group-name "$G" --filter-name access-denied-403 \
    --filter-pattern '{ $.status = 403 }' \
    --metric-transformations metricName=AccessDenied403,metricNamespace=FoodBank/Security,metricValue=1,defaultValue=0
  # Counts rejected tokens (forged/expired) - brute force or token tampering indicator.
  aws logs put-metric-filter --log-group-name "$G" --filter-name invalid-tokens \
    --filter-pattern '{ $.event = "AUTH_INVALID_TOKEN" }' \
    --metric-transformations metricName=InvalidTokens,metricNamespace=FoodBank/Security,metricValue=1,defaultValue=0
  # Counts failed calls to Mohamed's inventory-service (cross-service health).
  aws logs put-metric-filter --log-group-name "$G" --filter-name inventory-unreachable \
    --filter-pattern '{ $.event = "INVENTORY_SERVICE_UNREACHABLE" }' \
    --metric-transformations metricName=InventoryCallFailures,metricNamespace=FoodBank/Alerts,metricValue=1,defaultValue=0
done
# Counts failed scheduled scans.
aws logs put-metric-filter --log-group-name "/aws/lambda/${FN}" --filter-name scan-failed \
  --filter-pattern '{ $.event = "ALERT_SCAN_FAILED" }' \
  --metric-transformations metricName=ScanFailures,metricNamespace=FoodBank/Alerts,metricValue=1,defaultValue=0

aws cloudwatch put-metric-alarm --alarm-name foodbank-many-403s --namespace FoodBank/Security --metric-name AccessDenied403 \
  --statistic Sum --period 300 --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching --alarm-description "5+ forbidden requests in 5 minutes"
aws cloudwatch put-metric-alarm --alarm-name foodbank-expiry-scan-failed --namespace FoodBank/Alerts --metric-name ScanFailures \
  --statistic Sum --period 86400 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching --alarm-description "The daily expiry scan failed"
aws cloudwatch put-metric-alarm --alarm-name foodbank-expired-stock --namespace FoodBank/Alerts --metric-name ExpiredItemAlerts \
  --statistic Sum --period 86400 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching --alarm-description "At least one item reached its expiry date before being handled"

step "Done. Try:"
echo "curl ${API_URL}/health"
echo "aws lambda invoke --function-name ${FN} out.json && cat out.json"
