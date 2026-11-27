// Reporting - business logic (Nancy).
// Reads data written by the other two services and turns it into summaries:
//   inventory      <- food_items (Mohamed)
//   distributions  <- distributions + distribution_items (Momen)
//   waste          <- expiry_alerts (Nancy) joined with food_items
const { query } = require('../../db/pool');
const alertService = require('../alerts/alertService');

const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

// Builds "AND column >= $n" style filters with numbered parameters.
function filterBuilder() {
  const params = [];
  const parts = [];
  return {
    add(sql, value) { if (value === undefined) return; params.push(value); parts.push(sql.replace('?', `$${params.length}`)); },
    where(base = 'TRUE') { return [base, ...parts].join(' AND '); },
    params,
  };
}

const sumBy = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

// FUNCTION 3a - inventory summary by category.
// Filters: category, and from/to on the donation date.
async function inventorySummary({ category, from, to }) {
  const { warning_days } = await alertService.getSettings();
  const f = filterBuilder();
  f.params.push(warning_days); // $1
  f.add('category = ?', category);
  f.add('donation_date >= ?', from);
  f.add('donation_date <= ?', to);
  const { rows } = await query(
    `SELECT category,
            COUNT(*)                                                                  AS item_lines,
            COALESCE(SUM(quantity), 0)                                                AS total_quantity,
            COALESCE(SUM(quantity) FILTER (WHERE expiry_date < CURRENT_DATE), 0)      AS expired_quantity,
            COALESCE(SUM(quantity) FILTER (WHERE expiry_date >= CURRENT_DATE
                                             AND expiry_date <= CURRENT_DATE + $1::int), 0) AS expiring_soon_quantity,
            MIN(expiry_date) FILTER (WHERE expiry_date >= CURRENT_DATE)               AS next_expiry
     FROM food_items WHERE ${f.where('quantity > 0')}
     GROUP BY category ORDER BY category`,
    f.params
  );
  const total = sumBy(rows, 'total_quantity');
  return {
    report: 'inventory', generated_at: new Date().toISOString(), filters: { category: category || null, from: from || null, to: to || null },
    warning_days,
    totals: {
      item_lines: sumBy(rows, 'item_lines'),
      total_quantity: total,
      expired_quantity: sumBy(rows, 'expired_quantity'),
      expiring_soon_quantity: sumBy(rows, 'expiring_soon_quantity'),
      // percentage of current stock that is at risk (expired or expiring soon)
      at_risk_percent: total ? Math.round(((sumBy(rows, 'expired_quantity') + sumBy(rows, 'expiring_soon_quantity')) / total) * 1000) / 10 : 0,
    },
    by_category: rows,
  };
}

// FUNCTION 3b - distribution summary. Default period: last 30 days.
async function distributionSummary({ category, from, to }) {
  const period = { from: from || daysAgo(30), to: to || today() };
  const f = filterBuilder();
  f.add('d.distributed_at::date >= ?', period.from);
  f.add('d.distributed_at::date <= ?', period.to);
  f.add('fi.category = ?', category);
  const join = `FROM distributions d
                JOIN distribution_items di ON di.distribution_id = d.distribution_id
                JOIN food_items fi ON fi.item_id = di.item_id
                WHERE ${f.where()}`;

  const [byCat, totals, topItems] = await Promise.all([
    query(`SELECT fi.category, COUNT(DISTINCT d.distribution_id) AS distributions,
                  COUNT(DISTINCT d.family_id) AS families_served, SUM(di.quantity) AS quantity
           ${join} GROUP BY fi.category ORDER BY quantity DESC`, f.params),
    query(`SELECT COUNT(DISTINCT d.distribution_id) AS distributions, COUNT(DISTINCT d.family_id) AS families_served,
                  COALESCE(SUM(di.quantity), 0) AS quantity ${join}`, f.params),
    query(`SELECT fi.name, fi.category, SUM(di.quantity) AS quantity
           ${join} GROUP BY fi.name, fi.category ORDER BY quantity DESC LIMIT 5`, f.params),
  ]);
  return {
    report: 'distributions', generated_at: new Date().toISOString(), filters: { category: category || null, ...period },
    totals: totals.rows[0], by_category: byCat.rows, top_items: topItems.rows,
  };
}

// FUNCTION 3c - waste report: how many at-risk items were saved (distributed) versus thrown away.
async function wasteSummary({ category, from, to }) {
  const period = { from: from || daysAgo(30), to: to || today() };
  const f = filterBuilder();
  f.add('a.resolved_at::date >= ?', period.from);
  f.add('a.resolved_at::date <= ?', period.to);
  f.add('fi.category = ?', category);
  const { rows } = await query(
    `SELECT fi.category,
            COALESCE(SUM(COALESCE(a.resolved_quantity, a.quantity_at_alert)) FILTER (WHERE a.resolution_action = 'discarded'), 0)                   AS wasted_quantity,
            COALESCE(SUM(a.quantity_at_alert) FILTER (WHERE a.resolution_action IN ('distributed', 'stock_cleared')), 0) AS saved_quantity,
            COALESCE(SUM(COALESCE(a.resolved_quantity, a.quantity_at_alert)) FILTER (WHERE a.resolution_action = 'transferred'), 0)                 AS transferred_quantity,
            COUNT(*) AS alerts_closed
     FROM expiry_alerts a JOIN food_items fi ON fi.item_id = a.item_id
     WHERE ${f.where("a.status = 'resolved' AND a.resolution_action <> 'escalated'")}
     GROUP BY fi.category ORDER BY wasted_quantity DESC`,
    f.params
  );
  const wasted = sumBy(rows, 'wasted_quantity');
  const saved = sumBy(rows, 'saved_quantity');
  return {
    report: 'waste', generated_at: new Date().toISOString(), filters: { category: category || null, ...period },
    totals: {
      wasted_quantity: wasted, saved_quantity: saved, transferred_quantity: sumBy(rows, 'transferred_quantity'),
      alerts_closed: sumBy(rows, 'alerts_closed'),
      waste_rate_percent: wasted + saved ? Math.round((wasted / (wasted + saved)) * 1000) / 10 : 0,
    },
    by_category: rows,
  };
}

// Dashboard tiles used by the shared home page.
async function dashboard() {
  const [alerts, inv, dist] = await Promise.all([
    alertService.getAlertCounts(),
    inventorySummary({}),
    distributionSummary({ from: daysAgo(7), to: today() }),
  ]);
  return {
    alerts,
    stock: inv.totals,
    last_7_days: dist.totals,
  };
}

// Detailed rows used for CSV export (one line per item / per distributed line / per closed alert).
// Family contact details are deliberately NOT exported - only the household reference (data minimisation).
async function detailRows(type, { category, from, to }) {
  const f = filterBuilder();
  if (type === 'inventory') {
    f.add('category = ?', category); f.add('donation_date >= ?', from); f.add('donation_date <= ?', to);
    const { rows } = await query(
      `SELECT item_id, name, category, quantity, unit, donation_date, expiry_date,
              (expiry_date - CURRENT_DATE) AS days_left, storage_location
       FROM food_items WHERE ${f.where('quantity > 0')} ORDER BY expiry_date LIMIT 5000`, f.params);
    return { columns: ['item_id', 'name', 'category', 'quantity', 'unit', 'donation_date', 'expiry_date', 'days_left', 'storage_location'], rows };
  }
  const period = { from: from || daysAgo(30), to: to || today() };
  if (type === 'distributions') {
    f.add('d.distributed_at::date >= ?', period.from); f.add('d.distributed_at::date <= ?', period.to); f.add('fi.category = ?', category);
    const { rows } = await query(
      `SELECT d.distribution_id, to_char(d.distributed_at, 'YYYY-MM-DD HH24:MI') AS distributed_at, fam.household_ref,
              fi.name AS item, fi.category, di.quantity
       FROM distributions d JOIN distribution_items di ON di.distribution_id = d.distribution_id
       JOIN food_items fi ON fi.item_id = di.item_id JOIN families fam ON fam.family_id = d.family_id
       WHERE ${f.where()} ORDER BY d.distributed_at LIMIT 5000`, f.params);
    return { columns: ['distribution_id', 'distributed_at', 'household_ref', 'item', 'category', 'quantity'], rows };
  }
  // waste
  f.add('a.resolved_at::date >= ?', period.from); f.add('a.resolved_at::date <= ?', period.to); f.add('fi.category = ?', category);
  const { rows } = await query(
    `SELECT a.alert_id, fi.name AS item, fi.category, a.level, a.quantity_at_alert, a.expiry_date,
            to_char(a.resolved_at, 'YYYY-MM-DD HH24:MI') AS resolved_at, a.resolution_action, a.resolution_note
     FROM expiry_alerts a JOIN food_items fi ON fi.item_id = a.item_id
     WHERE ${f.where("a.status = 'resolved' AND a.resolution_action <> 'escalated'")} ORDER BY a.resolved_at LIMIT 5000`, f.params);
  return { columns: ['alert_id', 'item', 'category', 'level', 'quantity_at_alert', 'expiry_date', 'resolved_at', 'resolution_action', 'resolution_note'], rows };
}

module.exports = { inventorySummary, distributionSummary, wasteSummary, dashboard, detailRows };
