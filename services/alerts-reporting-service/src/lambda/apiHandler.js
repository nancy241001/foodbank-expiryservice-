// Runs this whole Express backend inside AWS Lambda, behind API Gateway.
// serverless-http turns the API Gateway event into a normal Express request and back.
// The same app.js is used locally (server.js) and in the cloud (this file).
const serverless = require('serverless-http');
const config = require('../config');
const { loadSecretsIntoEnv } = require('../aws/secrets');

let handler;

exports.handler = async (event, context) => {
  if (!handler) {
    await loadSecretsIntoEnv(); // only on a cold start; warm invocations re-use it
    if (!config.jwtSecret) throw new Error('JWT_SECRET not loaded');
    handler = serverless(require('../app'));
  }
  return handler(event, context);
};
