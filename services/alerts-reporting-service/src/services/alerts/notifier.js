// External integration: sends the expiry alert email through a real SMTP provider
// (e.g. Brevo, Mailtrap or Gmail with an app password). Credentials come from
// Secrets Manager / environment variables - never from the code.
// If SMTP is not configured, alerts still appear in the app (fallback agreed in the proposal).
const nodemailer = require('nodemailer');
const config = require('../../config');
const logger = require('../../utils/logger');

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      requireTLS: config.smtp.port !== 465, // never send credentials over plain text
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

function isConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

// Escape item names before putting them into HTML (item names are typed by staff).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildEmail(alerts) {
  const order = { expired: 0, critical: 1, warning: 2 };
  const sorted = [...alerts].sort((a, b) => order[a.level] - order[b.level] || String(a.expiry_date).localeCompare(String(b.expiry_date)));
  const lines = sorted.map((a) => `- [${a.level.toUpperCase()}] ${a.name} (${a.category}) x${a.quantity_at_alert}, expires ${a.expiry_date}`);
  const rows = sorted.map((a) => `<tr><td>${esc(a.level)}</td><td>${esc(a.name)}</td><td>${esc(a.category)}</td><td>${a.quantity_at_alert}</td><td>${esc(a.expiry_date)}</td></tr>`).join('');
  const expired = alerts.filter((a) => a.level === 'expired').length;
  return {
    subject: `Food bank: ${alerts.length} item(s) need attention${expired ? ` (${expired} expired)` : ''}`,
    text: `New expiry alerts:\n${lines.join('\n')}\n\nPlease distribute these items first or record how they were handled in the Alerts page.`,
    html: `<p>New expiry alerts:</p><table border="1" cellpadding="4"><tr><th>Level</th><th>Item</th><th>Category</th><th>Qty</th><th>Expiry</th></tr>${rows}</table>
           <p>Please distribute these items first or record how they were handled in the Alerts page.</p>`,
  };
}

// Sends ONE digest email for a whole scan (not one email per item) to avoid spamming staff.
async function sendExpiryDigest(recipients, alerts) {
  if (!alerts.length || !recipients.length) return { sent: false, reason: 'nothing to send' };
  if (!isConfigured()) return { sent: false, reason: 'smtp not configured' };
  const msg = buildEmail(alerts);
  const info = await getTransporter().sendMail({ from: config.smtp.from, to: recipients.join(', '), ...msg });
  logger.info('ALERT_EMAIL_SENT', { recipients: recipients.length, alerts: alerts.length, messageId: info.messageId });
  return { sent: true };
}

module.exports = { sendExpiryDigest, buildEmail, isConfigured };
