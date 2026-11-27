// Security tests for Nancy's endpoints (these become rows in the security test table).
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const h = require('./helpers');
const logger = require('../src/utils/logger');
const { safeCell } = require('../src/utils/csv');

let staff;
beforeAll(async () => {
  await h.resetDb();
  staff = await h.createUser('Staff', 'staff@test.local', 'staff');
});
afterAll(h.closePool);

const protectedEndpoints = [
  ['get', '/api/alerts'], ['get', '/api/alerts/expiry'], ['get', '/api/alerts/summary'], ['post', '/api/alerts/scan'],
  ['patch', '/api/alerts/1'], ['put', '/api/alerts/settings'], ['get', '/api/reports/inventory'],
  ['get', '/api/reports/distributions'], ['get', '/api/reports/waste'], ['post', '/api/reports/exports'],
  ['get', '/api/reports/exports'], ['get', '/api/reports/exports/1/download'], ['delete', '/api/reports/exports/1'],
];

describe('ST-N1 unauthenticated access', () => {
  test.each(protectedEndpoints)('%s %s without a token -> 401', async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
  });
});

describe('ST-N2 forged / expired / wrong-algorithm tokens', () => {
  test('token signed with a different secret -> 401', async () => {
    const forged = jwt.sign({ sub: String(staff.id), role: 'admin' }, 'attacker-secret');
    expect((await request(app).get('/api/alerts').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });
  test('expired token -> 401', async () => {
    const old = jwt.sign({ sub: String(staff.id), role: 'staff', exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/alerts').set('Authorization', `Bearer ${old}`)).status).toBe(401);
  });
  test('unsigned "alg: none" token claiming admin -> 401', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '1', role: 'admin' })}.`;
    expect((await request(app).put('/api/alerts/settings').set('Authorization', `Bearer ${none}`)).status).toBe(401);
  });
});

describe('ST-N3 unknown role cannot get in', () => {
  test('a valid token with role "family" -> 403', async () => {
    const t = jwt.sign({ sub: '999', role: 'family' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    expect((await request(app).get('/api/reports/inventory').set('Authorization', `Bearer ${t}`)).status).toBe(403);
  });
});

describe('ST-N4 malformed input', () => {
  test('broken JSON body -> 400, no stack trace leaked', async () => {
    const res = await request(app).post('/api/reports/exports').set(h.auth(staff))
      .set('Content-Type', 'application/json').send('{"type": "inventory"');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js|SyntaxError/);
  });
  test('body over 50kb -> 413', async () => {
    const res = await request(app).post('/api/reports/exports').set(h.auth(staff)).send({ type: 'x'.repeat(60000) });
    expect(res.status).toBe(413);
  });
  test('SQL injection in an id -> 400 (never reaches the database)', async () => {
    const res = await request(app).patch('/api/alerts/1%20OR%201=1').set(h.auth(staff)).send({ status: 'acknowledged' });
    expect(res.status).toBe(400);
  });
});

describe('ST-N5 security headers', () => {
  test('helmet headers are present and x-powered-by is hidden', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('ST-N6 logs never contain secrets', () => {
  test('redact() hides passwords/tokens and masks emails', () => {
    const out = logger.redact({ password: 'hunter2', token: 'eyJabc', smtp_pass: 'x', email: 'nancy@foodbank.org', nested: { Authorization: 'Bearer abc' } });
    expect(out).toEqual({ password: '[REDACTED]', token: '[REDACTED]', smtp_pass: '[REDACTED]', email: 'n***@foodbank.org', nested: { Authorization: '[REDACTED]' } });
  });
});

describe('ST-N7 CSV formula injection', () => {
  test.each(['=1+1', '+cmd', '-2', '@SUM(A1)'])('cell %s is neutralised', (v) => {
    expect(safeCell(v).startsWith("'") || safeCell(v).startsWith('"\'')).toBe(true);
  });
});

describe('ST-N8 secret exposure review of the repository', () => {
  const root = path.join(__dirname, '..', '..', '..'); // whole repository
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'data'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|json|sql|sh|ya?ml|html|md|http|example)$/.test(e.name)) files.push(p);
    }
  })(root);

  const patterns = [
    /postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@(?!HOST)[^\s/]+/i, // real connection string with password
    /AKIA[0-9A-Z]{16}/,                                         // real AWS access key id
    /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
    /xkeysib-[a-z0-9]{20,}/i,                                   // Brevo API key
    /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,              // SendGrid key
  ];
  test('no file contains a credential pattern', () => {
    const hits = files.filter((f) => !f.endsWith('security.test.js'))
      .filter((f) => patterns.some((re) => re.test(fs.readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });
  test('.env is git-ignored', () => {
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toMatch(/^\.env$/m);
  });
});
