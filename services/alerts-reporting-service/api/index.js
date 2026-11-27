// Vercel entry point: runs the same Express app as server.js and the Lambda handler.
// Secrets come from Vercel environment variables (DATABASE_URL, JWT_SECRET, ...), never from code.
const config = require('../src/config');

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET is missing or shorter than 32 characters');
}

module.exports = require('../src/app');
