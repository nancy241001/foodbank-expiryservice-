// Creates Nancy's AWS resources on Floci (or real AWS) using the AWS SDK - no AWS CLI or bash needed,
// so it runs on Windows with:  npm.cmd run floci:setup
// Safe to run again (every step is "create if missing, then make sure the settings are right").
// Reads values from YOUR .env and stores the secrets in Secrets Manager. Never prints a secret value.
//
// AWS services used by this component:
//   S3               private, encrypted, versioned bucket for report exports (+ lifecycle, CORS)
//   Secrets Manager  this service's DB URL + JWT secret, and the SMTP credentials
//   IAM              least-privilege roles for the API and the daily-scan Lambda (+ scheduler role)
//   CloudWatch       log groups, metric filters (403s, bad tokens, failed scans...) and alarms
//   Lambda + EventBridge Scheduler: only with --with-lambda (Floci needs Docker to RUN Lambda code)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const S3 = require('@aws-sdk/client-s3');
const SM = require('@aws-sdk/client-secrets-manager');
const IAM = require('@aws-sdk/client-iam');
const CWL = require('@aws-sdk/client-cloudwatch-logs');
const CW = require('@aws-sdk/client-cloudwatch');

const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const region = process.env.AWS_REGION || 'us-east-1';
const cfg = { region, endpoint, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test' } };
const s3 = new S3.S3Client({ ...cfg, forcePathStyle: true });
const sm = new SM.SecretsManagerClient(cfg);
const iam = new IAM.IAMClient(cfg);
const logs = new CWL.CloudWatchLogsClient(cfg);
const cw = new CW.CloudWatchClient(cfg);

const BUCKET = process.env.REPORTS_BUCKET || 'foodbank-reports';
const APP_SECRET = process.env.APP_SECRET_ID || 'foodbank/nancy/app';
const SMTP_SECRET = process.env.SMTP_SECRET_ID || 'foodbank/nancy/smtp';
const FRONTEND = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',')[0].trim();
const POLICIES = path.join(__dirname, '..', '..', '..', 'infra', 'floci', 'policies');
const API_LOG_GROUP = process.env.CW_LOG_GROUP || '/foodbank/api';

const done = [];
const step = (msg) => console.log(`\n==> ${msg}`);
const ok = (msg) => { console.log(`    ok  ${msg}`); done.push(msg); };
const ignoreExists = (err) => { if (!/exist|Conflict|AlreadyOwned|EntityAlreadyExists/i.test(`${err.name} ${err.message}`)) throw err; };

async function s3Bucket() {
  step('S3: private, encrypted bucket for report exports');
  await s3.send(new S3.CreateBucketCommand({ Bucket: BUCKET })).catch(ignoreExists);
  await s3.send(new S3.PutPublicAccessBlockCommand({ Bucket: BUCKET, PublicAccessBlockConfiguration: {
    BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
  await s3.send(new S3.PutBucketEncryptionCommand({ Bucket: BUCKET, ServerSideEncryptionConfiguration: {
    Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } }));
  await s3.send(new S3.PutBucketVersioningCommand({ Bucket: BUCKET, VersioningConfiguration: { Status: 'Enabled' } }));
  await s3.send(new S3.PutBucketLifecycleConfigurationCommand({ Bucket: BUCKET, LifecycleConfiguration: { Rules: [{
    ID: 'expire-old-exports', Status: 'Enabled', Filter: { Prefix: 'reports/' },
    Expiration: { Days: 90 }, NoncurrentVersionExpiration: { NoncurrentDays: 30 } }] } }));
  await s3.send(new S3.PutBucketCorsCommand({ Bucket: BUCKET, CORSConfiguration: { CORSRules: [{
    AllowedOrigins: [FRONTEND], AllowedMethods: ['GET'], AllowedHeaders: ['*'], MaxAgeSeconds: 300 }] } }));
  ok(`bucket ${BUCKET}: public access blocked, AES256 encryption, versioning, 90-day lifecycle, CORS for ${FRONTEND}`);
}

async function putSecret(name, values) {
  const SecretString = JSON.stringify(values);
  try {
    await sm.send(new SM.DescribeSecretCommand({ SecretId: name }));
    await sm.send(new SM.PutSecretValueCommand({ SecretId: name, SecretString }));
  } catch (err) {
    if (!/ResourceNotFound/i.test(err.name)) throw err;
    await sm.send(new SM.CreateSecretCommand({ Name: name, SecretString }));
  }
  ok(`secret ${name} (keys: ${Object.keys(values).join(', ')})`); // names only, never values
}

async function secrets() {
  step('Secrets Manager: values from your .env (nothing is printed)');
  const e = process.env;
  if (!e.DATABASE_URL || !e.JWT_SECRET) throw new Error('DATABASE_URL and JWT_SECRET must be set in .env first');
  await putSecret(APP_SECRET, { DATABASE_URL: e.DATABASE_URL, JWT_SECRET: e.JWT_SECRET });
  const smtp = { SMTP_HOST: e.SMTP_HOST || '', SMTP_PORT: e.SMTP_PORT || '587', SMTP_USER: e.SMTP_USER || '', SMTP_PASS: e.SMTP_PASS || '', SMTP_FROM: e.SMTP_FROM || '' };
  await putSecret(SMTP_SECRET, smtp);
  if (!smtp.SMTP_HOST) console.log('    note: SMTP not filled in .env yet - run this script again after setting up Brevo');
}

async function role(name, trustFile, policyName, policyDoc) {
  await iam.send(new IAM.CreateRoleCommand({ RoleName: name, AssumeRolePolicyDocument: fs.readFileSync(path.join(POLICIES, trustFile), 'utf8') })).catch(ignoreExists);
  await iam.send(new IAM.PutRolePolicyCommand({ RoleName: name, PolicyName: policyName, PolicyDocument: policyDoc }));
  ok(`role ${name} with inline policy ${policyName}`);
}

async function iamRoles() {
  step('IAM: least-privilege roles (each can do only its own job)');
  const read = (f) => fs.readFileSync(path.join(POLICIES, f), 'utf8');
  await role('nancy-alerts-api-role', 'lambda-trust.json', 'alerts-api-least-privilege', read('api-reports-policy.json'));
  await role('nancy-expiry-scan-role', 'lambda-trust.json', 'expiry-scan-least-privilege', read('expiry-scan-lambda-policy.json'));
  await role('nancy-scheduler-role', 'scheduler-trust.json', 'invoke-expiry-scan-only', JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: `arn:aws:lambda:${region}:000000000000:function:nancy-expiry-scan` }],
  }));
}

async function metricFilter(group, name, pattern, metric, namespace) {
  await logs.send(new CWL.PutMetricFilterCommand({ logGroupName: group, filterName: name, filterPattern: pattern,
    metricTransformations: [{ metricName: metric, metricNamespace: namespace, metricValue: '1', defaultValue: 0 }] }));
  ok(`metric filter ${name} on ${group} -> ${namespace}/${metric}`);
}

async function cloudwatch() {
  step('CloudWatch: log groups, metric filters and alarms');
  for (const g of [API_LOG_GROUP, '/aws/lambda/nancy-alerts-api', '/aws/lambda/nancy-expiry-scan']) {
    await logs.send(new CWL.CreateLogGroupCommand({ logGroupName: g })).catch(ignoreExists);
    await logs.send(new CWL.PutRetentionPolicyCommand({ logGroupName: g, retentionInDays: 14 }));
    ok(`log group ${g} (14-day retention)`);
  }
  for (const g of [API_LOG_GROUP, '/aws/lambda/nancy-alerts-api']) {
    await metricFilter(g, 'access-denied-403', '{ $.status = 403 }', 'AccessDenied403', 'FoodBank/Security');
    await metricFilter(g, 'invalid-tokens', '{ $.event = "AUTH_INVALID_TOKEN" }', 'InvalidTokens', 'FoodBank/Security');
    await metricFilter(g, 'inventory-unreachable', '{ $.event = "INVENTORY_SERVICE_UNREACHABLE" }', 'InventoryCallFailures', 'FoodBank/Alerts');
  }
  await metricFilter('/aws/lambda/nancy-expiry-scan', 'scan-failed', '{ $.event = "ALERT_SCAN_FAILED" }', 'ScanFailures', 'FoodBank/Alerts');

  const alarm = (AlarmName, Namespace, MetricName, Period, Threshold, AlarmDescription) => cw.send(new CW.PutMetricAlarmCommand({
    AlarmName, Namespace, MetricName, Statistic: 'Sum', Period, EvaluationPeriods: 1, Threshold,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmDescription })).then(() => ok(`alarm ${AlarmName}`));
  await alarm('foodbank-many-403s', 'FoodBank/Security', 'AccessDenied403', 300, 5, '5+ forbidden requests in 5 minutes');
  await alarm('foodbank-invalid-tokens', 'FoodBank/Security', 'InvalidTokens', 300, 5, '5+ forged or expired tokens in 5 minutes');
  await alarm('foodbank-expiry-scan-failed', 'FoodBank/Alerts', 'ScanFailures', 86400, 1, 'The daily expiry scan failed');
  await alarm('foodbank-expired-stock', 'FoodBank/Alerts', 'ExpiredItemAlerts', 86400, 1, 'An item reached its expiry date before being handled');
}

// ---------------------------------------------------------------- Lambda + Scheduler + API Gateway
// Only with --with-lambda: Floci runs Lambda code inside Docker containers, so Docker Desktop must be running.
const os = require('os');
const { execSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Builds a zip of src/ + production node_modules (no test tools), entirely in Node - works on Windows.
async function buildLambdaZip() {
  const archiver = require('archiver');
  const root = path.join(__dirname, '..');
  const build = path.join(os.tmpdir(), 'nancy-lambda-build');
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.cpSync(path.join(root, 'src'), path.join(build, 'src'), { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, f), path.join(build, f));
  console.log('    installing production packages for the Lambda (about a minute)...');
  execSync('npm ci --omit=dev --no-audit --no-fund --loglevel=error', { cwd: build, stdio: 'inherit', shell: true });
  const chunks = [];
  await new Promise((resolve, reject) => {
    const zip = archiver('zip', { zlib: { level: 9 } });
    zip.on('data', (c) => chunks.push(c)).on('end', resolve).on('error', reject);
    zip.directory(path.join(build, 'src'), 'src');
    zip.directory(path.join(build, 'node_modules'), 'node_modules');
    zip.file(path.join(build, 'package.json'), { name: 'package.json' });
    zip.finalize();
  });
  const buf = Buffer.concat(chunks);
  ok(`Lambda package built (${(buf.length / 1048576).toFixed(1)} MB, production code only)`);
  return buf;
}

async function deployFunction(lambda, name, handler, roleArn, env, zip) {
  const L = require('@aws-sdk/client-lambda');
  const Variables = env;
  let exists = true;
  try { await lambda.send(new L.GetFunctionCommand({ FunctionName: name })); } catch { exists = false; }
  if (exists) {
    await lambda.send(new L.UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zip }));
    for (let i = 0; i < 30; i += 1) {
      const f = await lambda.send(new L.GetFunctionConfigurationCommand({ FunctionName: name }));
      if (f.LastUpdateStatus !== 'InProgress') break;
      await sleep(1000);
    }
    await lambda.send(new L.UpdateFunctionConfigurationCommand({ FunctionName: name, Handler: handler, Environment: { Variables }, Timeout: 30, MemorySize: 256 }));
  } else {
    await lambda.send(new L.CreateFunctionCommand({ FunctionName: name, Runtime: 'nodejs22.x', Handler: handler, Role: roleArn,
      Code: { ZipFile: zip }, Timeout: 30, MemorySize: 256, Environment: { Variables } }));
  }
  for (let i = 0; i < 60; i += 1) {
    const f = await lambda.send(new L.GetFunctionConfigurationCommand({ FunctionName: name }));
    if (f.State === 'Active' || !f.State) { ok(`Lambda ${name} (${handler})`); return f.FunctionArn; }
    if (f.State === 'Failed') throw new Error(`Lambda ${name} failed: ${f.StateReason}`);
    await sleep(1000);
  }
  throw new Error(`Lambda ${name} did not become Active`);
}

async function lambdas() {
  step('Lambda + EventBridge Scheduler + API Gateway (needs Docker Desktop running)');
  const L = require('@aws-sdk/client-lambda');
  const SCH = require('@aws-sdk/client-scheduler');
  const AG = require('@aws-sdk/client-apigatewayv2');
  const lambda = new L.LambdaClient(cfg);
  const roleArn = async (n) => (await iam.send(new IAM.GetRoleCommand({ RoleName: n }))).Role.Arn;

  const zip = await buildLambdaZip();
  const common = {
    NODE_ENV: 'production', USE_SECRETS_MANAGER: 'true', APP_SECRET_ID: APP_SECRET, SMTP_SECRET_ID: SMTP_SECRET,
    CW_METRICS_ENABLED: 'true', REPORTS_BUCKET: BUCKET,
  };
  const apiArn = await deployFunction(lambda, 'nancy-alerts-api', 'src/lambda/apiHandler.handler', await roleArn('nancy-alerts-api-role'),
    { ...common, CORS_ORIGIN: FRONTEND, INVENTORY_API_URL: process.env.LAMBDA_INVENTORY_API_URL || 'http://host.docker.internal:3001' }, zip);
  const scanArn = await deployFunction(lambda, 'nancy-expiry-scan', 'src/lambda/expiryScanHandler.handler', await roleArn('nancy-expiry-scan-role'), common, zip);

  // Daily scan at 08:00 Cairo time
  const sch = new SCH.SchedulerClient(cfg);
  await sch.send(new SCH.DeleteScheduleCommand({ Name: 'nancy-daily-expiry-scan' })).catch(() => {});
  await sch.send(new SCH.CreateScheduleCommand({
    Name: 'nancy-daily-expiry-scan', ScheduleExpression: 'cron(0 8 * * ? *)', ScheduleExpressionTimezone: 'Africa/Cairo',
    FlexibleTimeWindow: { Mode: 'OFF' }, Target: { Arn: scanArn, RoleArn: await roleArn('nancy-scheduler-role'), Input: '{}' },
  }));
  ok('EventBridge schedule nancy-daily-expiry-scan (every day 08:00 Africa/Cairo -> nancy-expiry-scan)');

  // HTTP API in front of Nancy's backend only
  const ag = new AG.ApiGatewayV2Client(cfg);
  const apis = await ag.send(new AG.GetApisCommand({}));
  let api = (apis.Items || []).find((a) => a.Name === 'nancy-alerts-reporting-api');
  if (!api) {
    api = await ag.send(new AG.CreateApiCommand({ Name: 'nancy-alerts-reporting-api', ProtocolType: 'HTTP' }));
    const integ = await ag.send(new AG.CreateIntegrationCommand({ ApiId: api.ApiId, IntegrationType: 'AWS_PROXY', IntegrationUri: apiArn, PayloadFormatVersion: '2.0' }));
    for (const RouteKey of ['ANY /api/alerts', 'ANY /api/alerts/{proxy+}', 'ANY /api/reports/{proxy+}', 'GET /health', 'OPTIONS /{proxy+}']) {
      await ag.send(new AG.CreateRouteCommand({ ApiId: api.ApiId, RouteKey, Target: `integrations/${integ.IntegrationId}` }));
    }
    await ag.send(new AG.CreateStageCommand({ ApiId: api.ApiId, StageName: '$default', AutoDeploy: true }));
    await lambda.send(new L.AddPermissionCommand({ FunctionName: 'nancy-alerts-api', StatementId: 'apigw-invoke', Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com', SourceArn: `arn:aws:execute-api:${region}:000000000000:${api.ApiId}/*` })).catch(() => {});
  }
  const url = `http://${api.ApiId}.execute-api.localhost.floci.io:4566`;
  ok(`API Gateway nancy-alerts-reporting-api -> ${url}`);
  return { url, lambda, L };
}

async function tryLambdas(ctx) {
  // Quick live checks: run the scan Lambda once, and call /health through API Gateway.
  try {
    const out = await ctx.lambda.send(new ctx.L.InvokeCommand({ FunctionName: 'nancy-expiry-scan', Payload: Buffer.from('{}') }));
    const body = Buffer.from(out.Payload || []).toString();
    console.log(`    test: nancy-expiry-scan -> ${out.FunctionError ? `ERROR ${body.slice(0, 300)}` : body.slice(0, 200)}`);
  } catch (err) { console.log(`    test: nancy-expiry-scan could not run (${err.name}: ${err.message})`); }
  try {
    console.log('    (first API call starts the Lambda container - can take 1-3 minutes)');
    const res = await fetch(`${ctx.url}/health`, { signal: AbortSignal.timeout(180000) });
    console.log(`    test: GET ${ctx.url}/health -> ${res.status} ${(await res.text()).slice(0, 120)}`);
  } catch (err) { console.log(`    test: API Gateway /health could not be reached (${err.message})`); }
}

(async () => {
  console.log(`Setting up Nancy's AWS resources on ${endpoint} (${region})`);
  try {
    await s3.send(new S3.ListBucketsCommand({}));
  } catch (err) {
    console.error(`\nCannot reach Floci at ${endpoint}. Is floci-aws running in another window? (${err.name})`);
    process.exit(1);
  }
  try {
    await s3Bucket();
    await secrets();
    await iamRoles();
    await cloudwatch();
    if (process.argv.includes('--with-lambda')) {
      const ctx = await lambdas();
      await tryLambdas(ctx);
      console.log(`\nFrontend: to use the cloud API instead of localhost, set alerts: '${ctx.url}' in frontend/js/config.js`);
    } else {
      console.log('\n(Lambda, Scheduler and API Gateway skipped. With Docker Desktop running: npm.cmd run floci:deploy)');
    }
    console.log(`\nDone: ${done.length} resources ready. Next: npm.cmd run floci:check`);
    console.log('Then in .env set  CW_LOG_GROUP=/foodbank/api  and  CW_METRICS_ENABLED=true  and restart the backend.');
  } catch (err) {
    console.error(`\nFAILED at the step above: ${err.name}: ${err.message}`);
    process.exit(1);
  }
})();
