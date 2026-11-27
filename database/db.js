// Connection used by the database setup scripts (run once, by the database lead, with the OWNER login).
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Client } = require('pg');

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy database/.env.example to database/.env and fill it in.');
  const tls = /neon\.tech|sslmode=require/.test(url);
  // Neon requires TLS; rejectUnauthorized checks Neon's certificate, so traffic cannot be intercepted.
  const client = new Client({ connectionString: url.replace(/[?&]channel_binding=require/, ''), ssl: tls ? { rejectUnauthorized: true } : undefined });
  return client.connect().then(() => client);
}

module.exports = { connect };
