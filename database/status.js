// Read-only check: row counts per table and which service logins exist with which rights.
// Useful as evidence for the report ("data model" and "least privilege" sections).
const { connect } = require('./db');

const TABLES = ['users', 'food_items', 'families', 'distributions', 'distribution_items', 'alert_settings', 'expiry_alerts', 'saved_reports'];

async function main() {
  const db = await connect();
  try {
    console.log('Rows per table:');
    for (const t of TABLES) {
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${t}`).catch(() => ({ rows: [{ n: 'missing' }] }));
      console.log(`  ${t.padEnd(20)} ${rows[0].n}`);
    }
    const { rows } = await db.query(
      `SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS rights
       FROM information_schema.role_table_grants
       WHERE grantee IN ('inventory_service', 'distribution_service', 'alerts_service')
       GROUP BY grantee, table_name ORDER BY grantee, table_name`
    );
    console.log('\nService logins and their table rights:');
    if (!rows.length) console.log('  none yet - see database/README.md step 4');
    for (const r of rows) console.log(`  ${r.grantee.padEnd(22)} ${r.table_name.padEnd(20)} ${r.rights}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('status failed:', err.message); process.exit(1); });
