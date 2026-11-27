// TEST TOOL ONLY: prints a login token so Nancy's API can be tested (Postman / REST Client)
// before Momen's login service is running. It signs with YOUR .env JWT_SECRET, exactly like
// Momen's service will. Refuses to run in production.
//   npm run token -- <user_id> <staff|admin>        e.g.  npm run token -- 2 staff
require('dotenv').config();
const jwt = require('jsonwebtoken');

if (process.env.NODE_ENV === 'production') { console.error('not in production'); process.exit(1); }
const [id, role] = process.argv.slice(2);
if (!/^\d+$/.test(id || '') || !['staff', 'admin'].includes(role)) {
  console.error('usage: npm run token -- <user_id> <staff|admin>   (user ids: admin=1, staff1=2, staff2=3 after database seed)');
  process.exit(1);
}
if (!process.env.JWT_SECRET) { console.error('JWT_SECRET missing in .env'); process.exit(1); }
const names = { 1: 'Admin User', 2: 'Staff One', 3: 'Staff Two' };
console.log(jwt.sign({ sub: id, role, name: names[id] || `User ${id}` }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '2h' }));
