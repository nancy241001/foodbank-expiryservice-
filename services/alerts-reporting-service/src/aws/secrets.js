// Loads secrets from AWS Secrets Manager into process.env at startup.
// Locally you can use a .env file instead (USE_SECRETS_MANAGER=false).
// Each secret is a JSON object, e.g. foodbank/nancy/smtp = {"SMTP_HOST":"...","SMTP_USER":"...","SMTP_PASS":"..."}
const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const clients = require('./clients');
const config = require('../config');
const logger = require('../utils/logger');

async function loadSecret(secretId) {
  const out = await clients.secrets().send(new GetSecretValueCommand({ SecretId: secretId }));
  const values = JSON.parse(out.SecretString || '{}');
  for (const [k, v] of Object.entries(values)) process.env[k] = String(v);
  return Object.keys(values); // names only - never log the values
}

async function loadSecretsIntoEnv() {
  if (!config.aws.useSecretsManager) return;
  for (const id of [config.aws.appSecretId, config.aws.smtpSecretId]) {
    const keys = await loadSecret(id);
    logger.info('SECRETS_LOADED', { secretId: id, keys });
  }
  // refresh the config object with the new values
  config.databaseUrl = process.env.DATABASE_URL;
  config.jwtSecret = process.env.JWT_SECRET;
  Object.assign(config.smtp, {
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM || config.smtp.from,
  });
}

module.exports = { loadSecretsIntoEnv };
