jest.mock('../src/clients/inventoryClient', () => ({ setItemQuantity: jest.fn() }));
// Functional tests for Reports and Exports (Nancy). S3 is mocked.
jest.mock('../src/aws/s3Storage', () => ({
  putReport: jest.fn().mockResolvedValue(),
  deleteReport: jest.fn().mockResolvedValue(),
  signedDownloadUrl: jest.fn().mockResolvedValue('http://localhost:4566/foodbank-reports/x?X-Amz-Signature=abc'),
}));
const request = require('supertest');
const storage = require('../src/aws/s3Storage');
const app = require('../src/app');
const h = require('./helpers');
const inventoryClient = require('../src/clients/inventoryClient');

inventoryClient.setItemQuantity.mockImplementation(h.fakeInventoryUpdate);

let admin; let staff1; let staff2; let milk; let beans;

beforeAll(async () => {
  await h.resetDb();
  admin = await h.createUser('Admin', 'admin@test.local', 'admin');
  staff1 = await h.createUser('Staff One', 's1@test.local', 'staff');
  staff2 = await h.createUser('Staff Two', 's2@test.local', 'staff');
  milk = await h.addItem({ name: 'Milk', category: 'dairy', quantity: 40, expiresIn: -1 });
  await h.addItem({ name: 'Cheese', category: 'dairy', quantity: 10, expiresIn: 4 });
  beans = await h.addItem({ name: '=HYPERLINK("http://evil")', category: 'canned', quantity: 100, expiresIn: 300 });
  await h.distribute('HH-001', staff1.id, [[beans, 20]]);
  await h.distribute('HH-002', staff1.id, [[beans, 10]]);
});
afterAll(h.closePool);

describe('F3 - summary reports', () => {
  test('inventory summary calculates expired / expiring / at-risk %', async () => {
    const res = await request(app).get('/api/reports/inventory').set(h.auth(staff1));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ total_quantity: 120, expired_quantity: 40, expiring_soon_quantity: 10, at_risk_percent: 41.7 });
    const dairy = res.body.by_category.find((c) => c.category === 'dairy');
    expect(dairy).toMatchObject({ item_lines: 2, total_quantity: 50 });
  });
  test('inventory summary filters by category', async () => {
    const res = await request(app).get('/api/reports/inventory?category=canned').set(h.auth(staff1));
    expect(res.body.by_category).toHaveLength(1);
    expect(res.body.totals.total_quantity).toBe(70);
  });
  test('distribution summary counts families and quantities', async () => {
    const res = await request(app).get('/api/reports/distributions').set(h.auth(staff2));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ distributions: 2, families_served: 2, quantity: 30 });
  });
  test('waste summary reflects resolved alerts', async () => {
    await request(app).post('/api/alerts/scan').set(h.auth(admin));
    const { body } = await request(app).get('/api/alerts?level=expired').set(h.auth(admin));
    await request(app).patch(`/api/alerts/${body.alerts[0].alert_id}`).set(h.auth(admin))
      .send({ status: 'resolved', resolution_action: 'discarded' });
    const res = await request(app).get('/api/reports/waste').set(h.auth(staff1));
    expect(res.body.totals).toMatchObject({ wasted_quantity: 40, saved_quantity: 0, waste_rate_percent: 100 });
  });
  test('dashboard combines alerts, stock and last 7 days', async () => {
    const res = await request(app).get('/api/reports/dashboard').set(h.auth(staff1));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('alerts.active');
    expect(res.body.last_7_days.families_served).toBe(2);
  });
  test.each([
    ['from=2026-02-31'], ['from=31-01-2026'], ['from=2026-05-01&to=2026-04-01'],
    ['from=2024-01-01&to=2026-01-01'], ["category=dairy' OR 1=1--"],
  ])('rejects bad filter %s with 400', async (qs) => {
    const res = await request(app).get(`/api/reports/distributions?${qs}`).set(h.auth(staff1));
    expect(res.status).toBe(400);
  });
});

describe('F4 - exports with ownership', () => {
  let s1Export;
  test('staff1 exports an inventory CSV to S3 (201)', async () => {
    const res = await request(app).post('/api/reports/exports').set(h.auth(staff1)).send({ type: 'inventory', category: 'canned' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ report_type: 'inventory', owner_user_id: staff1.id, row_count: 1 });
    s1Export = res.body.report_id;
    const [key, csv] = storage.putReport.mock.calls[0];
    expect(key).toMatch(new RegExp(`^reports/user-${staff1.id}/inventory-`));
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`); // CSV-injection neutralised
  });
  test('staff2 exports a distributions CSV; no family contact data in it', async () => {
    const res = await request(app).post('/api/reports/exports').set(h.auth(staff2)).send({ type: 'distributions' });
    expect(res.status).toBe(201);
    const csv = storage.putReport.mock.calls[1][1];
    expect(csv.split('\r\n')[0]).toBe('distribution_id,distributed_at,household_ref,item,category,quantity');
  });
  test('staff only see their own exports; admin sees all', async () => {
    const mine = await request(app).get('/api/reports/exports').set(h.auth(staff1));
    expect(mine.body.exports.every((e) => e.owner_user_id === staff1.id)).toBe(true);
    const all = await request(app).get('/api/reports/exports').set(h.auth(admin));
    expect(all.body.count).toBe(2);
  });
  test('OWNERSHIP: staff2 cannot download or delete staff1 export (403)', async () => {
    expect((await request(app).get(`/api/reports/exports/${s1Export}/download`).set(h.auth(staff2))).status).toBe(403);
    expect((await request(app).delete(`/api/reports/exports/${s1Export}`).set(h.auth(staff2))).status).toBe(403);
    expect(storage.deleteReport).not.toHaveBeenCalled();
  });
  test('owner gets a short-lived link; admin can too', async () => {
    const res = await request(app).get(`/api/reports/exports/${s1Export}/download`).set(h.auth(staff1));
    expect(res.status).toBe(200);
    expect(res.body.expires_in_seconds).toBe(300);
    expect((await request(app).get(`/api/reports/exports/${s1Export}/download`).set(h.auth(admin))).status).toBe(200);
  });
  test('owner deletes the export (204), then it is gone (404)', async () => {
    expect((await request(app).delete(`/api/reports/exports/${s1Export}`).set(h.auth(staff1))).status).toBe(204);
    expect(storage.deleteReport).toHaveBeenCalledTimes(1);
    expect((await request(app).get(`/api/reports/exports/${s1Export}/download`).set(h.auth(staff1))).status).toBe(404);
  });
  test.each([[{}], [{ type: 'salaries' }], [{ type: 'inventory', s3_key: 'reports/user-1/x.csv' }], [{ type: 'waste', from: 'yesterday' }]])(
    'rejects invalid export body %j with 400', async (body) => {
      const res = await request(app).post('/api/reports/exports').set(h.auth(staff1)).send(body);
      expect(res.status).toBe(400);
    }
  );
  test('LIMIT: the 21st export for one user is refused (409)', async () => {
    await h.query(
      `INSERT INTO saved_reports (owner_user_id, report_type, s3_key, row_count, size_bytes)
       SELECT $1, 'inventory', 'reports/fake-' || g, 0, 0 FROM generate_series(1, 20) g`, [staff1.id]
    );
    const res = await request(app).post('/api/reports/exports').set(h.auth(staff1)).send({ type: 'inventory' });
    expect(res.status).toBe(409);
  });
});
