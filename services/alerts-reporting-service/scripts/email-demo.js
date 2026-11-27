// DEMO HELPER: turns email alerts on for one address, then runs a scan, so you can prove the email integration.
//   node scripts/email-demo.js you@gmail.com
// It signs a short-lived ADMIN test token with your own .env JWT_SECRET (same idea as test-token.js)
// and never prints the token. Refuses to run in production.
require('dotenv').config();
const jwt = require('jsonwebtoken');

const to = (process.argv[2] || '').trim();
if (!/^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(to)) {
  console.error('usage: node scripts/email-demo.js you@gmail.com'); process.exit(1);
}
if (process.env.NODE_ENV === 'production') { console.error('not in production'); process.exit(1); }
if (!process.env.JWT_SECRET) { console.error('JWT_SECRET missing in .env'); process.exit(1); }

const base = `http://localhost:${process.env.PORT || 3003}`;
const token = jwt.sign({ sub: '1', role: 'admin', name: 'Admin User' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

(async () => {
  let r = await fetch(`${base}/api/alerts/settings`, {
    method: 'PUT', headers,
    body: JSON.stringify({ warning_days: 7, critical_days: 2, email_enabled: true, notify_emails: [to] }),
  });
  console.log('1) settings ->', r.status, JSON.stringify(await r.json()));
  r = await fetch(`${base}/api/alerts/scan`, { method: 'POST', headers });
  const scan = await r.json();
  console.log('2) scan     ->', r.status, JSON.stringify(scan));
  if (scan.email && scan.email.sent) console.log(`\nEmail sent. Check ${to} (and the spam folder).`);
  else if (scan.created === 0) console.log('\nNo NEW alert was created, so no email was sent (delete one alert in Neon and run again).');
  else console.log('\nEmail not sent. Reason:', scan.email && scan.email.reason, '- see the backend window for details.');
})().catch((e) => { console.error('Could not reach the backend:', e.message, '- is npm.cmd start running?'); process.exit(1); });
