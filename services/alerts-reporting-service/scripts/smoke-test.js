// SMOKE TEST: checks the RUNNING backend (npm start in another window) against the real database.
// Creates short-lived test tokens with YOUR .env JWT_SECRET (like Momen's login will), calls the API,
// and prints PASS/FAIL. Never prints secrets or tokens. Refuses to run in production.
//   npm.cmd run smoke
require('dotenv').config();
const jwt = require('jsonwebtoken');

if (process.env.NODE_ENV === 'production') { console.error('not in production'); process.exit(1); }
if (!process.env.JWT_SECRET) { console.error('JWT_SECRET missing in .env'); process.exit(1); }

const BASE = `http://localhost:${process.env.PORT || 3003}`;
const sign = (sub, role, name, secret = process.env.JWT_SECRET) =>
  jwt.sign({ sub: String(sub), role, name }, secret, { algorithm: 'HS256', expiresIn: '10m' });
const staff = sign(2, 'staff', 'Staff One');
const staff2 = sign(3, 'staff', 'Staff Two');
const admin = sign(1, 'admin', 'Admin User');
const forged = sign(1, 'admin', 'Attacker', 'not-the-real-secret');

async function call(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, data: { error: `cannot reach ${BASE} - is npm start running? (${err.message})` } };
  }
}

const results = [];
function check(name, ok, detail) { results.push({ name, ok: Boolean(ok), detail }); }

(async () => {
  let r = await call('GET', '/health');
  check('Backend is running (GET /health)', r.status === 200, `status ${r.status}`);
  if (r.status !== 200) return report();

  // --- security
  r = await call('GET', '/api/alerts');
  check('No token -> 401', r.status === 401, `status ${r.status}`);
  r = await call('GET', '/api/alerts', forged);
  check('Forged token (wrong secret) -> 401', r.status === 401, `status ${r.status}`);
  r = await call('PUT', '/api/alerts/settings', staff, { warning_days: 7, critical_days: 2, email_enabled: false, notify_emails: [] });
  check('Staff changing settings -> 403', r.status === 403, `status ${r.status}`);
  r = await call('GET', '/api/reports/distributions?from=2026-02-31', staff);
  check('Impossible date -> 400', r.status === 400, `status ${r.status}`);

  // --- database connection + real data
  r = await call('GET', '/api/reports/inventory', staff);
  check('Database connection works (inventory report)', r.status === 200,
    r.status === 200 ? `${r.data.totals.item_lines} item lines, ${r.data.totals.total_quantity} units in stock` : `status ${r.status} ${JSON.stringify(r.data)}`);

  r = await call('GET', '/api/alerts/expiry', staff);
  check('F1 items expiring soon', r.status === 200, r.status === 200 ? `${r.data.count} items within ${r.data.window_days} days` : `status ${r.status}`);

  r = await call('POST', '/api/alerts/scan', staff);
  check('F2 run expiry scan', r.status === 201,
    r.status === 201 ? `${r.data.created} new alerts, ${r.data.active_alerts} active` : `status ${r.status} ${JSON.stringify(r.data)}`);

  r = await call('GET', '/api/alerts', staff);
  const alerts = r.status === 200 ? r.data.alerts : [];
  check('F2 list alerts', r.status === 200, `${alerts.length} active alerts`);

  const open = alerts.find((a) => a.status === 'open');
  if (open) {
    r = await call('PATCH', `/api/alerts/${open.alert_id}`, staff, { status: 'acknowledged' });
    check('F2 staff acknowledges an alert', r.status === 200, `alert #${open.alert_id} (${open.name}) status ${r.status}`);
    r = await call('PATCH', `/api/alerts/${open.alert_id}`, staff2, { status: 'resolved', resolution_action: 'other', note: 'ownership test' });
    check('Ownership: another staff member cannot resolve it -> 403', r.status === 403, `status ${r.status}`);
  } else {
    check('F2 acknowledge / ownership', true, 'skipped: no open alert left (already handled earlier)');
  }

  r = await call('GET', '/api/reports/distributions', staff);
  check('F3 distribution report', r.status === 200, r.status === 200 ? `${r.data.totals.distributions} distributions, ${r.data.totals.families_served} families` : `status ${r.status}`);
  r = await call('GET', '/api/reports/waste', staff);
  check('F3 waste report', r.status === 200, r.status === 200 ? `waste rate ${r.data.totals.waste_rate_percent}%` : `status ${r.status}`);
  r = await call('GET', '/api/reports/dashboard', admin);
  check('Dashboard (admin)', r.status === 200, r.status === 200 ? `alerts: ${JSON.stringify(r.data.alerts)}` : `status ${r.status}`);

  r = await call('POST', '/api/reports/exports', staff, { type: 'inventory' });
  check('F4 CSV export to S3 (needs Floci running)', r.status === 201,
    r.status === 201 ? `export #${r.data.report_id} saved` : `status ${r.status} - expected until Floci/S3 is running`);

  report();
})();

function report() {
  console.log('\nSMOKE TEST against', BASE, '\n');
  for (const t of results) console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name.padEnd(58)} ${t.detail || ''}`);
  const failed = results.filter((t) => !t.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
}
