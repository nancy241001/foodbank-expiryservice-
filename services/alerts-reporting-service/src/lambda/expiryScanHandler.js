// AWS Lambda function: runs the expiry scan once a day.
// Triggered by an EventBridge Scheduler rule (see infra/floci/setup-nancy.sh).
// It re-uses exactly the same runScan() as the "Run scan" button, so the rules are in one place.
const { loadSecretsIntoEnv } = require('../aws/secrets');
const alertService = require('../services/alerts/alertService');
const logger = require('../utils/logger');

let secretsLoaded = false;

exports.handler = async () => {
  try {
    if (!secretsLoaded) { await loadSecretsIntoEnv(); secretsLoaded = true; } // cached between warm invocations
    const summary = await alertService.runScan({ trigger: 'schedule' });
    return { ok: true, ...summary };
  } catch (err) {
    // This exact event name is what the CloudWatch metric filter + alarm watch for.
    logger.error('ALERT_SCAN_FAILED', { message: err.message, code: err.code });
    throw err; // let Lambda mark the run as failed (and retry)
  }
};
