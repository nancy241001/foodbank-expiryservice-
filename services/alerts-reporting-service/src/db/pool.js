// One shared PostgreSQL connection pool for the whole API.
// A pool re-uses connections instead of opening a new one for every request.
const { Pool, types } = require('pg');
const config = require('../config');

// Return DATE columns as plain 'YYYY-MM-DD' text. Without this, pg turns them into
// JavaScript Dates at local midnight, which can shift an expiry date by a day.
types.setTypeParser(1082, (value) => value);
// COUNT/SUM come back as bigint text; turn them into normal numbers (safe at our scale).
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

let pool;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set');
    const needsTls = /neon\.tech|sslmode=require/.test(config.databaseUrl);
    pool = new Pool({
      connectionString: config.databaseUrl,
      // Neon requires TLS, so data is encrypted in transit between API and database.
      ssl: needsTls ? { rejectUnauthorized: true } : undefined,
      max: 5, // coursework scale; keeps us inside the free tier connection limit
    });
  }
  return pool;
}

// Every query in the app goes through here with $1, $2 placeholders
// (parameterised queries) so user input is never pasted into SQL text.
function query(text, params) {
  return getPool().query(text, params);
}

// Runs several queries as one all-or-nothing transaction.
async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}

module.exports = { query, withTransaction, getPool, closePool };
