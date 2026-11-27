// Starts the API: load secrets first (Secrets Manager or .env), then listen.
const config = require('./config');
const { loadSecretsIntoEnv } = require('./aws/secrets');
const logger = require('./utils/logger');

// Explains a bad DATABASE_URL at start-up instead of failing on every request.
// Never prints the URL itself, because it contains the password.
function checkDatabaseUrl(url) {
  if (!url) throw new Error('DATABASE_URL is not set in .env');
  if (/\s|^["']|["']$/.test(url)) throw new Error('DATABASE_URL contains a space or quote marks - remove them');
  if (/\bPASSWORD@|@HOST\//.test(url)) throw new Error('DATABASE_URL still contains the PASSWORD or HOST placeholder');
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error('DATABASE_URL is not a valid URL. Usually the password contains one of  @ : / # ? % [ ]  - '
      + 'set a new password without those characters (ALTER ROLE ... WITH PASSWORD) or percent-encode it');
  }
  if (!parsed.protocol.startsWith('postgres')) throw new Error('DATABASE_URL must start with postgresql://');
  if (!parsed.hostname.endsWith('.neon.tech') && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    logger.warn('DATABASE_URL_UNUSUAL_HOST', { host: parsed.hostname });
  }
}

async function start() {
  await loadSecretsIntoEnv();
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters');
  }
  checkDatabaseUrl(config.databaseUrl);
  const app = require('./app');
  app.listen(config.port, () => logger.info('SERVER_STARTED', { port: config.port, env: config.nodeEnv }));
}

start().catch((err) => {
  console.error('failed to start:', err.message);
  process.exit(1);
});
