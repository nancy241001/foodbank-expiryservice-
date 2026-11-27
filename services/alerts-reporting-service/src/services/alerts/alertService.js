// Expiry Alerts - business logic (Nancy).
// Controllers handle HTTP; this file holds the rules, so the same code is used by
// the API (manual "Run scan" button) and by the scheduled Lambda (daily scan).
const { query, withTransaction } = require('../../db/pool');
const { HttpError } = require('../../utils/httpError');
const { LEVEL_RANK } = require('../../constants');
const notifier = require('./notifier');
const inventoryClient = require('../../clients/inventoryClient');
const metrics = require('../../aws/metrics');
const logger = require('../../utils/logger');

// Severity rule: past expiry = expired; within critical_days = critical; otherwise warning.
function levelFor(daysLeft, settings) {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= settings.critical_days) return 'critical';
  return 'warning';
}

async function getSettings(client = { query }) {
  const { rows } = await client.query(
    'SELECT warning_days, critical_days, email_enabled, notify_emails, updated_at FROM alert_settings WHERE id = 1'
  );
  return rows[0];
}

async function updateSettings({ warning_days, critical_days, email_enabled, notify_emails }, userId) {
  if (critical_days >= warning_days) throw new HttpError(400, 'critical_days must be smaller than warning_days');
  if (email_enabled && notify_emails.length === 0) throw new HttpError(400, 'add at least one email address to enable email alerts');
  const { rows } = await query(
    `UPDATE alert_settings SET warning_days = $1, critical_days = $2, email_enabled = $3,
            notify_emails = $4, updated_by = $5, updated_at = now()
     WHERE id = 1 RETURNING warning_days, critical_days, email_enabled, notify_emails, updated_at`,
    [warning_days, critical_days, email_enabled, notify_emails, userId]
  );
  logger.info('ALERT_SETTINGS_UPDATED', { userId, warning_days, critical_days, email_enabled, recipients: notify_emails.length });
  return rows[0];
}

// FUNCTION 1 - live look-up of items that are about to expire (read-only).
async function getExpiringItems({ days, category }) {
  const settings = await getSettings();
  const windowDays = days ?? settings.warning_days;
  const params = [windowDays];
  let where = 'f.quantity > 0 AND f.expiry_date <= CURRENT_DATE + $1::int';
  if (category) { params.push(category); where += ` AND f.category = $${params.length}`; }

  const { rows } = await query(
    `SELECT f.item_id, f.name, f.category, f.quantity, f.unit, f.expiry_date, f.storage_location,
            (f.expiry_date - CURRENT_DATE) AS days_left,
            EXISTS (SELECT 1 FROM expiry_alerts a WHERE a.item_id = f.item_id AND a.status <> 'resolved') AS has_active_alert
     FROM food_items f WHERE ${where}
     ORDER BY f.expiry_date ASC, f.quantity DESC`, // first-expiry-first-out order
    params
  );
  const items = rows.map((r) => ({ ...r, level: levelFor(r.days_left, settings) }));
  return { window_days: windowDays, category: category || null, count: items.length, items };
}

// FUNCTION 2a - scan inventory and create / escalate / auto-resolve alerts.
async function runScan({ trigger, userId = null }) {
  const result = await withTransaction(async (client) => {
    // Advisory lock: if the scheduled Lambda and a staff member press "scan" at the same time,
    // the second waits instead of creating duplicate alerts.
    await client.query('SELECT pg_advisory_xact_lock(424242)');
    const settings = await getSettings(client);

    const { rows: candidates } = await client.query(
      `SELECT item_id, name, category, quantity, expiry_date, (expiry_date - CURRENT_DATE) AS days_left
       FROM food_items WHERE quantity > 0 AND expiry_date <= CURRENT_DATE + $1::int`,
      [settings.warning_days]
    );
    const { rows: active } = await client.query(
      "SELECT alert_id, item_id, level FROM expiry_alerts WHERE status <> 'resolved'"
    );
    const activeByItem = new Map(active.map((a) => [a.item_id, a]));
    const candidateIds = new Set(candidates.map((c) => c.item_id));

    const created = [];
    let escalated = 0;
    for (const item of candidates) {
      const level = levelFor(item.days_left, settings);
      const existing = activeByItem.get(item.item_id);
      if (existing && existing.level === level) continue; // already alerted at this level

      if (existing) {
        // Level changed (e.g. warning -> critical). Close the old alert and open a new one.
        const action = LEVEL_RANK[level] > LEVEL_RANK[existing.level] ? 'escalated' : 'other';
        await client.query(
          `UPDATE expiry_alerts SET status = 'resolved', resolved_at = now(), resolution_action = $2,
                  resolution_note = $3 WHERE alert_id = $1`,
          [existing.alert_id, action, `level changed to ${level} by scan`]
        );
        escalated += 1;
      }
      const { rows } = await client.query(
        `INSERT INTO expiry_alerts (item_id, level, quantity_at_alert, expiry_date)
         VALUES ($1, $2, $3, $4) RETURNING alert_id, item_id, level, quantity_at_alert, expiry_date`,
        [item.item_id, level, item.quantity, item.expiry_date]
      );
      created.push({ ...rows[0], name: item.name, category: item.category });
    }

    // Integration with Distribution: once Momen's service gives out all of an item (quantity 0),
    // or Mohamed's service corrects the expiry date outside the window, the alert closes itself.
    let autoResolved = 0;
    for (const a of active) {
      if (candidateIds.has(a.item_id)) continue;
      const { rows } = await client.query('SELECT quantity FROM food_items WHERE item_id = $1', [a.item_id]);
      const cleared = rows[0] && rows[0].quantity === 0;
      await client.query(
        `UPDATE expiry_alerts SET status = 'resolved', resolved_at = now(), resolution_action = $2,
                resolution_note = $3 WHERE alert_id = $1`,
        [a.alert_id, cleared ? 'stock_cleared' : 'other',
          cleared ? 'all stock distributed or removed' : 'expiry date no longer inside warning window']
      );
      autoResolved += 1;
    }

    const { rows: openRows } = await client.query(
      "SELECT COUNT(*) AS n FROM expiry_alerts WHERE status <> 'resolved'"
    );
    return { settings, created, escalated, autoResolved, scanned: candidates.length, activeAlerts: openRows[0].n };
  });

  // Email happens AFTER the transaction commits: a slow or failing mail server
  // must not roll back the alerts or hold the database lock.
  let email = { sent: false, reason: 'email disabled' };
  if (result.settings.email_enabled && result.created.length) {
    try {
      email = await notifier.sendExpiryDigest(result.settings.notify_emails, result.created);
      if (email.sent) {
        await query('UPDATE expiry_alerts SET emailed_at = now() WHERE alert_id = ANY($1::int[])', [result.created.map((a) => a.alert_id)]);
      }
    } catch (err) {
      email = { sent: false, reason: 'smtp error' };
      logger.error('ALERT_EMAIL_FAILED', { message: err.message, alerts: result.created.length });
    }
  }

  const summary = {
    trigger, scanned: result.scanned, created: result.created.length, escalated: result.escalated,
    auto_resolved: result.autoResolved, active_alerts: result.activeAlerts, email,
  };
  logger.info('ALERT_SCAN_COMPLETED', { userId, ...summary });
  await metrics.putMetrics({
    ActiveExpiryAlerts: result.activeAlerts,
    NewExpiryAlerts: result.created.length,
    ExpiredItemAlerts: result.created.filter((a) => a.level === 'expired').length,
    AlertEmailFailures: email.reason === 'smtp error' ? 1 : 0,
  });
  return summary;
}

// FUNCTION 2b - list alerts for staff with filters.
async function listAlerts({ status, level, category }) {
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`a.status = $${params.length}`); } else where.push("a.status <> 'resolved'");
  if (level) { params.push(level); where.push(`a.level = $${params.length}`); }
  if (category) { params.push(category); where.push(`f.category = $${params.length}`); }

  const { rows } = await query(
    `SELECT a.alert_id, a.item_id, f.name, f.category, f.quantity AS current_quantity, f.unit,
            a.level, a.status, a.quantity_at_alert, a.expiry_date, (a.expiry_date - CURRENT_DATE) AS days_left,
            a.created_at, a.emailed_at, a.acknowledged_by, ua.name AS acknowledged_by_name, a.acknowledged_at,
            a.resolved_by, a.resolved_at, a.resolution_action, a.resolution_note
     FROM expiry_alerts a
     JOIN food_items f ON f.item_id = a.item_id
     LEFT JOIN users ua ON ua.user_id = a.acknowledged_by
     WHERE ${where.join(' AND ')}
     ORDER BY CASE a.level WHEN 'expired' THEN 0 WHEN 'critical' THEN 1 ELSE 2 END, a.expiry_date ASC
     LIMIT 500`,
    params
  );
  return rows;
}

// FUNCTION 2c - status workflow: open -> acknowledged -> resolved.
async function updateAlertStatus(alertId, { status, resolution_action, note }, user) {
  return withTransaction(async (client) => {
    // FOR UPDATE locks the row so two people cannot resolve the same alert at the same moment.
    const { rows } = await client.query(
      'SELECT alert_id, item_id, level, status, acknowledged_by FROM expiry_alerts WHERE alert_id = $1 FOR UPDATE',
      [alertId]
    );
    const alert = rows[0];
    if (!alert) throw new HttpError(404, 'Alert not found');
    if (alert.status === 'resolved') throw new HttpError(409, 'Alert is already resolved');

    if (status === 'acknowledged') {
      if (alert.status !== 'open') throw new HttpError(409, 'Only open alerts can be acknowledged');
      const { rows: updated } = await client.query(
        `UPDATE expiry_alerts SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now()
         WHERE alert_id = $1 RETURNING alert_id, status, acknowledged_by, acknowledged_at`,
        [alertId, user.id]
      );
      logger.info('ALERT_ACKNOWLEDGED', { alertId, userId: user.id });
      return updated[0];
    }

    // status === 'resolved'
    // Ownership rule: once a staff member acknowledges an alert it is "theirs";
    // only that person or an admin may close it.
    if (alert.status === 'acknowledged' && alert.acknowledged_by !== user.id && user.role !== 'admin') {
      logger.warn('ACCESS_DENIED_OWNERSHIP', { alertId, userId: user.id, ownerId: alert.acknowledged_by, status: 403 });
      throw new HttpError(403, 'This alert was acknowledged by another staff member; only they or an admin can resolve it');
    }
    // Food-safety rules
    if (resolution_action === 'distributed' && alert.level === 'expired') {
      throw new HttpError(409, 'Expired food cannot be marked as distributed');
    }
    if (resolution_action === 'discarded' && alert.level !== 'expired' && user.role !== 'admin') {
      throw new HttpError(403, 'Only an admin can discard food that has not expired yet');
    }
    if (resolution_action === 'other' && !note) throw new HttpError(400, 'note is required when resolution_action is "other"');

    // Integration with Inventory (Mohamed's backend): discarded or transferred stock has physically
    // left the food bank, so we ask the inventory-service to set its quantity to 0. If that call fails,
    // we throw, the transaction rolls back and the alert stays open: both services stay consistent.
    let removed = null;
    if (resolution_action === 'discarded' || resolution_action === 'transferred') {
      const { rows: item } = await client.query('SELECT quantity FROM food_items WHERE item_id = $1', [alert.item_id]);
      removed = item[0] ? item[0].quantity : 0;
      if (removed > 0) await inventoryClient.setItemQuantity(alert.item_id, 0, user.token);
      logger.info('STOCK_REMOVAL_REQUESTED', { alertId, itemId: alert.item_id, quantity: removed, action: resolution_action, userId: user.id });
    }

    const { rows: updated } = await client.query(
      `UPDATE expiry_alerts SET status = 'resolved', resolved_by = $2, resolved_at = now(),
              acknowledged_by = COALESCE(acknowledged_by, $2), acknowledged_at = COALESCE(acknowledged_at, now()),
              resolution_action = $3, resolution_note = $4, resolved_quantity = $5
       WHERE alert_id = $1
       RETURNING alert_id, status, resolved_by, resolved_at, resolution_action, resolution_note, resolved_quantity`,
      [alertId, user.id, resolution_action, note || null, removed]
    );
    logger.info('ALERT_RESOLVED', { alertId, userId: user.id, action: resolution_action });
    return updated[0];
  });
}

// Small summary used by the navigation badge on every page (dashboard integration).
async function getAlertCounts() {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE status <> 'resolved') AS active,
            COUNT(*) FILTER (WHERE status <> 'resolved' AND level = 'expired') AS expired,
            COUNT(*) FILTER (WHERE status <> 'resolved' AND level = 'critical') AS critical,
            COUNT(*) FILTER (WHERE status <> 'resolved' AND level = 'warning') AS warning
     FROM expiry_alerts`
  );
  return rows[0];
}

module.exports = { levelFor, getSettings, updateSettings, getExpiringItems, runScan, listAlerts, updateAlertStatus, getAlertCounts };
