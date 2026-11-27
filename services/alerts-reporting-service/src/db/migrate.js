// Applies Nancy's tables (database/schema/04_alerts_reporting.sql, the single source of truth).
// On Neon the whole schema is normally created once with `database/` setup; this is for local use and tests.
// The SQL uses IF NOT EXISTS, so running it again does no harm.
const fs = require('fs');
const path = require('path');
const { query, closePool } = require('./pool');

async function migrate() {
  const file = path.join(__dirname, '..', '..', '..', '..', 'database', 'schema', '04_alerts_reporting.sql');
  await query(fs.readFileSync(file, 'utf8'));
  console.log('applied 04_alerts_reporting.sql');
}

if (require.main === module) {
  migrate()
    .then(closePool)
    .catch(async (err) => {
      console.error('migration failed:', err.message);
      if (/permission denied/.test(err.message)) console.error('On Neon, tables are created once by the owner with `npm run setup` in database/. This backend\'s restricted login (alerts_service) cannot create tables, by design.');
      await closePool(); process.exit(1);
    });
}

module.exports = { migrate };
