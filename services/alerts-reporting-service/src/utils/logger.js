// Structured JSON logger.
// - Always prints one JSON line to the console (Lambda/Floci forwards this to CloudWatch Logs).
// - If CW_LOG_GROUP is set, also ships the lines to CloudWatch Logs directly.
// - Never logs passwords, tokens or full email addresses (see redact()).
const config = require('../config');

const SECRET_KEYS = /pass(word)?|token|secret|authorization|cookie|smtp_pass|api[-_]?key/i;

function maskEmail(value) {
  return value.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)/g, '$1***@$2');
}

function redact(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === 'string') return maskEmail(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

// --- optional direct shipping to CloudWatch Logs (used when the API runs outside Lambda) ---
let queue = [];
let timer;
let cwClient;
const streamName = `api-${new Date().toISOString().slice(0, 10)}-${process.pid}`;
let streamReady = false;

async function flush() {
  if (!queue.length || !config.aws.logGroup) return;
  const batch = queue.splice(0, queue.length);
  try {
    const { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    cwClient = cwClient || new CloudWatchLogsClient({ region: config.aws.region, endpoint: config.aws.endpoint });
    if (!streamReady) {
      await cwClient.send(new CreateLogStreamCommand({ logGroupName: config.aws.logGroup, logStreamName: streamName })).catch(() => {});
      streamReady = true;
    }
    await cwClient.send(new PutLogEventsCommand({ logGroupName: config.aws.logGroup, logStreamName: streamName, logEvents: batch }));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'CLOUDWATCH_SHIP_FAILED', message: err.message }));
  }
}

function write(level, event, data = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), service: config.serviceName, level, event, ...redact(data) });
  if (process.env.NODE_ENV !== 'test') console.log(line);
  if (config.aws.logGroup) {
    queue.push({ timestamp: Date.now(), message: line });
    if (!timer) timer = setInterval(flush, 3000).unref();
  }
}

module.exports = {
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data),
  flush,
  redact,
};
