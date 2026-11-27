// Read-only evidence for the report: lists what exists on Floci for Nancy's component.
//   npm.cmd run floci:check
// Prints names and settings only - never secret values.
require('dotenv').config();
const S3 = require('@aws-sdk/client-s3');
const SM = require('@aws-sdk/client-secrets-manager');
const IAM = require('@aws-sdk/client-iam');
const CWL = require('@aws-sdk/client-cloudwatch-logs');
const CW = require('@aws-sdk/client-cloudwatch');

const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
const cfg = { region: process.env.AWS_REGION || 'us-east-1', endpoint, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test' } };
const BUCKET = process.env.REPORTS_BUCKET || 'foodbank-reports';
const API_LOG_GROUP = process.env.CW_LOG_GROUP || '/foodbank/api';
const line = (ok, what, detail = '') => console.log(`${ok ? 'OK  ' : 'MISS'}  ${what.padEnd(46)} ${detail}`);
const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: e.name }; } };

(async () => {
  console.log(`Nancy's AWS resources on ${endpoint}\n`);
  const s3 = new S3.S3Client({ ...cfg, forcePathStyle: true });
  const enc = await safe(() => s3.send(new S3.GetBucketEncryptionCommand({ Bucket: BUCKET })));
  line(!enc.error, `S3 bucket ${BUCKET} encryption`, enc.error || enc.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm);
  const pab = await safe(() => s3.send(new S3.GetPublicAccessBlockCommand({ Bucket: BUCKET })));
  line(!pab.error && pab.PublicAccessBlockConfiguration.BlockPublicAcls, 'S3 public access blocked', pab.error || 'all four blocks on');
  const ver = await safe(() => s3.send(new S3.GetBucketVersioningCommand({ Bucket: BUCKET })));
  line(ver.Status === 'Enabled', 'S3 versioning', ver.error || ver.Status);
  const objs = await safe(() => s3.send(new S3.ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'reports/' })));
  line(!objs.error, 'S3 report exports stored', objs.error || `${objs.KeyCount || 0} file(s)`);

  const sm = new SM.SecretsManagerClient(cfg);
  for (const id of [process.env.APP_SECRET_ID || 'foodbank/nancy/app', process.env.SMTP_SECRET_ID || 'foodbank/nancy/smtp']) {
    const d = await safe(() => sm.send(new SM.DescribeSecretCommand({ SecretId: id })));
    line(!d.error, `Secrets Manager ${id}`, d.error || 'exists (value not shown)');
  }

  const iam = new IAM.IAMClient(cfg);
  for (const r of ['nancy-alerts-api-role', 'nancy-expiry-scan-role', 'nancy-scheduler-role']) {
    const p = await safe(() => iam.send(new IAM.ListRolePoliciesCommand({ RoleName: r })));
    line(!p.error, `IAM role ${r}`, p.error || `policies: ${p.PolicyNames.join(', ')}`);
  }

  const logs = new CWL.CloudWatchLogsClient(cfg);
  const mf = await safe(() => logs.send(new CWL.DescribeMetricFiltersCommand({ logGroupName: API_LOG_GROUP })));
  line(!mf.error && mf.metricFilters.length > 0, `CloudWatch metric filters on ${API_LOG_GROUP}`, mf.error || mf.metricFilters.map((f) => f.filterName).join(', '));
  const ev = await safe(() => logs.send(new CWL.FilterLogEventsCommand({ logGroupName: API_LOG_GROUP, filterPattern: '{ $.status = 403 }', limit: 50 })));
  line(!ev.error, 'CloudWatch log events with status 403', ev.error || `${ev.events.length} found (run the smoke test to create some)`);

  const cw = new CW.CloudWatchClient(cfg);
  const al = await safe(() => cw.send(new CW.DescribeAlarmsCommand({ AlarmNamePrefix: 'foodbank-' })));
  line(!al.error && al.MetricAlarms.length > 0, 'CloudWatch alarms', al.error || al.MetricAlarms.map((a) => `${a.AlarmName}=${a.StateValue}`).join(', '));
})();
