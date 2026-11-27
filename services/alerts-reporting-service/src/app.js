// alerts-reporting-service (Nancy): its own Express backend, separate from the other students'.
// Kept separate from server.js so tests and the Lambda wrapper can use the app without a network port.
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const logger = require('./utils/logger');
const { HttpError } = require('./utils/httpError');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind API Gateway / a proxy, so req.ip is the real client

app.use(helmet()); // secure HTTP headers (CSP, no-sniff, frame protection, ...)
app.use(cors({
  origin: config.corsOrigin.split(',').map((o) => o.trim()), // only our own frontend may call the API
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50kb' })); // refuse huge bodies

// Access log: one line per request. 401/403/5xx lines are what the monitoring filters look for.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('HTTP_REQUEST', {
      method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
      ms: Date.now() - start, userId: req.user && req.user.id, role: req.user && req.user.role, ip: req.ip,
    });
  });
  next();
});

app.get('/health', (req, res) => res.json({ service: config.serviceName, status: 'ok', time: new Date().toISOString() }));

// Only Nancy's routes live in this backend. Login is in Momen's backend, items in Mohamed's.
app.use('/api/alerts', require('./services/alerts/alertRoutes'));
app.use('/api/reports', require('./services/reports/reportRoutes'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Central error handler: known errors keep their status; anything unexpected becomes a
// generic 500 so stack traces and SQL details never reach the browser.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  logger.error('UNHANDLED_ERROR', { method: req.method, path: req.originalUrl, message: err.message, code: err.code });
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
