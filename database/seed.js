// Loads DEMO data for testing and the demo video: 1 admin, 2 staff, donated items in every
// category with different expiry dates, families, and past distributions.
// Runs only on an empty database (it refuses if food_items already has rows), in one transaction.
// Stock is reduced for every distributed line, exactly as the Distribution service would.
const bcrypt = require('bcryptjs');
const { connect } = require('./db');

const DAY = 86400000;
const date = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

// name, category, quantity, unit, expires in (days), donor_type, donor_name, location
const ITEMS = [
  ['Milk 1L', 'dairy', 40, 'bottle', -1, 'shop', 'Fresh Mart', 'Fridge A'],
  ['Yoghurt cups', 'dairy', 60, 'pot', 1, 'shop', 'Fresh Mart', 'Fridge A'],
  ['White cheese 500g', 'dairy', 25, 'pack', 9, 'organization', 'Dairy Co-op', 'Fridge B'],
  ['Bread loaf', 'bakery', 30, 'loaf', 2, 'shop', 'Corner Bakery', 'Shelf 1'],
  ['Pita bread (10 pack)', 'bakery', 45, 'pack', 4, 'shop', 'Corner Bakery', 'Shelf 1'],
  ['Bananas', 'fresh', 50, 'kg', 3, 'individual', null, 'Crate 2'],
  ['Tomatoes', 'fresh', 35, 'kg', 6, 'organization', 'City Farmers Market', 'Crate 3'],
  ['Potatoes', 'fresh', 80, 'kg', 25, 'organization', 'City Farmers Market', 'Crate 4'],
  ['Rice 5kg', 'dry', 40, 'bag', 240, 'organization', 'Grain Aid', 'Shelf 3'],
  ['Pasta 500g', 'dry', 120, 'pack', 300, 'shop', 'Hyper One', 'Shelf 3'],
  ['Lentils 1kg', 'dry', 70, 'bag', 365, 'individual', null, 'Shelf 4'],
  ['Canned beans', 'canned', 150, 'can', 6, 'shop', 'Hyper One', 'Shelf 5'],
  ['Canned tuna', 'canned', 90, 'can', 400, 'organization', 'Grain Aid', 'Shelf 5'],
  ['Frozen chicken 1kg', 'frozen', 20, 'pack', 60, 'shop', 'Fresh Mart', 'Freezer 1'],
  ['Frozen vegetables', 'frozen', 35, 'bag', 120, 'individual', null, 'Freezer 1'],
  ['Bottled water 1.5L', 'beverages', 200, 'bottle', 500, 'organization', 'Water For All', 'Pallet 1'],
  ['Orange juice 1L', 'beverages', 30, 'carton', 12, 'shop', 'Hyper One', 'Fridge B'],
  ['Soap bars', 'hygiene', 100, 'bar', 900, 'organization', 'Clean Hands NGO', 'Shelf 6'],
  ['Baby formula', 'other', 15, 'tin', 45, 'individual', null, 'Shelf 7'],
];

const FAMILIES = [['FAM-0001', 4, '01000000001'], ['FAM-0002', 2, null], ['FAM-0003', 6, '01000000003'],
  ['FAM-0004', 3, null], ['FAM-0005', 5, '01000000005'], ['FAM-0006', 1, null]];

// days ago, family index, staff index, [[item index, quantity], ...]
const DISTRIBUTIONS = [
  [28, 0, 0, [[8, 2], [9, 6], [12, 4]]], [21, 1, 1, [[9, 4], [10, 3]]], [17, 2, 0, [[8, 3], [11, 10], [15, 12]]],
  [12, 3, 1, [[7, 6], [12, 4], [17, 4]]], [8, 4, 0, [[9, 8], [13, 2], [15, 10]]], [5, 0, 1, [[10, 4], [16, 6]]],
  [3, 5, 0, [[3, 2], [5, 3], [11, 6]]], [1, 2, 1, [[1, 12], [4, 6], [6, 4]]],
];

async function main() {
  const { SEED_ADMIN_PASSWORD, SEED_STAFF_PASSWORD } = process.env;
  if (!SEED_ADMIN_PASSWORD || !SEED_STAFF_PASSWORD || SEED_ADMIN_PASSWORD.length < 10 || SEED_STAFF_PASSWORD.length < 10) {
    throw new Error('Set SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD (10+ characters each) in database/.env');
  }
  const db = await connect();
  try {
    const { rows: existing } = await db.query('SELECT COUNT(*)::int AS n FROM food_items');
    if (existing[0].n > 0) throw new Error('food_items already has data - seed only runs on an empty database');

    await db.query('BEGIN');
    const userIds = [];
    for (const [name, email, pw, role] of [
      ['Admin User', 'admin@foodbank.local', SEED_ADMIN_PASSWORD, 'admin'],
      ['Staff One', 'staff1@foodbank.local', SEED_STAFF_PASSWORD, 'staff'],
      ['Staff Two', 'staff2@foodbank.local', SEED_STAFF_PASSWORD, 'staff'],
    ]) {
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
         RETURNING user_id`,
        [name, email, await bcrypt.hash(pw, 12), role]
      );
      userIds.push(rows[0].user_id);
    }
    const staff = userIds.slice(1);

    const itemIds = [];
    for (const [name, category, qty, unit, expiresIn, donorType, donorName, location] of ITEMS) {
      const { rows } = await db.query(
        `INSERT INTO food_items (name, category, quantity, unit, donation_date, expiry_date, donor_type, donor_name, storage_location, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING item_id`,
        [name, category, qty, unit, date(-30), date(expiresIn), donorType, donorName, location, staff[0]]
      );
      itemIds.push(rows[0].item_id);
    }

    const familyIds = [];
    for (const [ref, size, phone] of FAMILIES) {
      const { rows } = await db.query(
        'INSERT INTO families (household_ref, household_size, contact_phone, created_by) VALUES ($1, $2, $3, $4) RETURNING family_id',
        [ref, size, phone, staff[0]]
      );
      familyIds.push(rows[0].family_id);
    }

    for (const [daysAgo, fam, st, lines] of DISTRIBUTIONS) {
      const { rows } = await db.query(
        "INSERT INTO distributions (family_id, staff_user_id, distributed_at) VALUES ($1, $2, now() - ($3 || ' days')::interval) RETURNING distribution_id",
        [familyIds[fam], staff[st], String(daysAgo)]
      );
      for (const [idx, qty] of lines) {
        await db.query('INSERT INTO distribution_items (distribution_id, item_id, quantity) VALUES ($1, $2, $3)', [rows[0].distribution_id, itemIds[idx], qty]);
        await db.query('UPDATE food_items SET quantity = quantity - $2, updated_at = now() WHERE item_id = $1', [itemIds[idx], qty]);
      }
    }
    await db.query('COMMIT');
    console.log(`seeded: 3 users, ${ITEMS.length} items, ${FAMILIES.length} families, ${DISTRIBUTIONS.length} distributions`);
    console.log('log in as admin@foodbank.local / staff1@foodbank.local / staff2@foodbank.local with the passwords from database/.env');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('seed failed:', err.message); process.exit(1); });
