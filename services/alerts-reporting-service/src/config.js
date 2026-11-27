// Central place for configuration. Every value comes from environment variables
// (a local .env file, or Secrets Manager when deployed) - never from source code.
require('dotenv').config();

const config = {
  serviceName: 'alerts-reporting-service',
  port: Number(process.env.PORT || 3003),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  // Mohamed's backend. Used to change stock when food is discarded or transferred.
  inventoryApiUrl: (process.env.INVENTORY_API_URL || 'http://localhost:3001').replace(/\/$/, ''),

  aws: {
    // Floci listens on 4566. Leave AWS_ENDPOINT_URL empty to use real AWS.
    endpoint: process.env.AWS_ENDPOINT_URL || undefined,
    region: process.env.AWS_REGION || 'us-east-1',
    reportsBucket: process.env.REPORTS_BUCKET || 'foodbank-reports',
    logGroup: process.env.CW_LOG_GROUP || '', // empty = only log to the console
    metricsEnabled: process.env.CW_METRICS_ENABLED === 'true',
    useSecretsManager: process.env.USE_SECRETS_MANAGER === 'true',
    appSecretId: process.env.APP_SECRET_ID || 'foodbank/nancy/app',
    smtpSecretId: process.env.SMTP_SECRET_ID || 'foodbank/nancy/smtp',
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'Food Bank Alerts <alerts@example.com>',
  },
};

module.exports = config;
