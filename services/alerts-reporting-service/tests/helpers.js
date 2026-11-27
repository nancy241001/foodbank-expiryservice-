// Test helpers: fresh database for each test file, users, tokens and sample data.
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query, closePool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');

const DAY = 86400000;
const isoDate = (offset) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

// Teammates' tables (files 01-03 in database/schema). In production their owners create them.
async function applyTeammatesSchema() {
  const dir = path.join(__dirname, '..', '..', '..', 'database', 'schema');
  for (const f of ['01_users.sql', '02_inventory.sql', '03_distribution.sql']) {
    await query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}

async function resetDb() {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  // teammates' tables (in production they come from their own backends)
  await applyTeammatesSchema();
  await migrate(); // Nancy's own tables
}

async function createUser(name, email, role, password = 'Correct-Horse-9') {
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING user_id',
    [name, email, hash, role]
  );
  const id = rows[0].user_id;
  const token = jwt.sign({ sub: String(id), role, name }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  return { id, token, role, email, password };
}

async function addItem({ name, category = 'dairy', quantity = 10, expiresIn = 3, donatedDaysAgo = 5 }) {
  const { rows } = await query(
    `INSERT INTO food_items (name, category, quantity, donation_date, expiry_date)
     VALUES ($1, $2, $3, $4, $5) RETURNING item_id`,
    [name, category, quantity, isoDate(-donatedDaysAgo), isoDate(expiresIn)]
  );
  return rows[0].item_id;
}

// Simulates Mohamed's inventory-service: what PATCH /api/items/:id {quantity} does to the shared DB.
const fakeInventoryUpdate = async (itemId, quantity) => {
  await query('UPDATE food_items SET quantity = $2 WHERE item_id = $1', [itemId, quantity]);
};

// Simulates Momen's Distribution service: records a distribution and reduces stock.
async function distribute(familyRef, staffId, lines) {
  const fam = await query(
    `INSERT INTO families (household_ref, household_size, created_by) VALUES ($1, 3, $2)
     ON CONFLICT (household_ref) DO UPDATE SET household_size = 3 RETURNING family_id`,
    [familyRef, staffId]
  );
  const d = await query('INSERT INTO distributions (family_id, staff_user_id) VALUES ($1, $2) RETURNING distribution_id',
    [fam.rows[0].family_id, staffId]);
  for (const [itemId, qty] of lines) {
    await query('INSERT INTO distribution_items (distribution_id, item_id, quantity) VALUES ($1, $2, $3)', [d.rows[0].distribution_id, itemId, qty]);
    await query('UPDATE food_items SET quantity = quantity - $2 WHERE item_id = $1', [itemId, qty]);
  }
}

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

module.exports = { fakeInventoryUpdate, resetDb, createUser, addItem, distribute, auth, isoDate, query, closePool };
