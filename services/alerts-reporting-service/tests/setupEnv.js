// Test-only settings. Points at a throwaway local database, never at Neon.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5433/foodbank_test';
process.env.JWT_SECRET = 'test-only-secret-not-used-anywhere-else-0123456789';
process.env.CW_LOG_GROUP = '';
process.env.CW_METRICS_ENABLED = 'false';
process.env.USE_SECRETS_MANAGER = 'false';
process.env.INVENTORY_API_URL = 'http://inventory.test.local';
process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'tester';
process.env.SMTP_PASS = 'not-a-real-password';
