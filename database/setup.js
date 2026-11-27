// Creates ALL tables for the three services, in dependency order, in ONE transaction:
// either everything is created or nothing is (no half-built database).
// Safe to run again: every statement uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
const fs = require('fs');
const path = require('path');
const { connect } = require('./db');

const FILES = [
  ['01_users.sql', 'Momen - users (auth)'],
  ['02_inventory.sql', 'Mohamed - food_items'],
  ['03_distribution.sql', 'Momen - families, distributions, distribution_items'],
  ['04_alerts_reporting.sql', 'Nancy - alert_settings, expiry_alerts, saved_reports'],
];

async function main() {
  const db = await connect();
  try {
    await db.query('BEGIN');
    for (const [file, label] of FILES) {
      await db.query(fs.readFileSync(path.join(__dirname, 'schema', file), 'utf8'));
      console.log(`applied ${file.padEnd(26)} ${label}`);
    }
    await db.query('COMMIT');
    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log(`\nTables now in the database (${rows.length}): ${rows.map((r) => r.table_name).join(', ')}`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('setup failed:', err.message); process.exit(1); });
