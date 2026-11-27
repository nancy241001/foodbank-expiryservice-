jest.mock('../src/clients/inventoryClient', () => ({ setItemQuantity: jest.fn() }));
// Functional + business-rule tests for Expiry Alerts (Nancy).
jest.mock('nodemailer', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
  return { createTransport: () => ({ sendMail }), __sendMail: sendMail };
});
const request = require('supertest');
const nodemailer = require('nodemailer');
const app = require('../src/app');
const h = require('./helpers');
const inventoryClient = require('../src/clients/inventoryClient');

inventoryClient.setItemQuantity.mockImplementation(h.fakeInventoryUpdate);

let admin; let staff1; let staff2;
const ids = {};

beforeAll(async () => {
  await h.resetDb();
  admin = await h.createUser('Admin', 'admin@test.local', 'admin');
  staff1 = await h.createUser('Staff One', 's1@test.local', 'staff');
  staff2 = await h.createUser('Staff Two', 's2@test.local', 'staff');
  ids.expired = await h.addItem({ name: 'Old milk', expiresIn: -1 });
  ids.critical = await h.addItem({ name: 'Yoghurt', expiresIn: 1 });
  ids.warning = await h.addItem({ name: 'Bananas', category: 'fresh', expiresIn: 5 });
  ids.safe = await h.addItem({ name: 'Rice', category: 'dry', expiresIn: 200 });
  ids.empty = await h.addItem({ name: 'Empty bread', category: 'bakery', quantity: 0, expiresIn: 1 });
});
afterAll(h.closePool);

describe('F1 - GET /api/alerts/expiry', () => {
  test('lists items inside the warning window with the right level, soonest first', async () => {
    const res = await request(app).get('/api/alerts/expiry').set(h.auth(staff1));
    expect(res.status).toBe(200);
    expect(res.body.window_days).toBe(7);
    expect(res.body.items.map((i) => [i.name, i.level])).toEqual([
      ['Old milk', 'expired'], ['Yoghurt', 'critical'], ['Bananas', 'warning'],
    ]); // Rice is too far away, Empty bread has no stock
  });
  test('filters by category and custom window', async () => {
    const res = await request(app).get('/api/alerts/expiry?category=fresh&days=10').set(h.auth(staff1));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('Bananas');
  });
  test.each([['days=0'], ['days=91'], ['days=abc'], ['category=weapons']])('rejects invalid query %s with 400', async (qs) => {
    const res = await request(app).get(`/api/alerts/expiry?${qs}`).set(h.auth(staff1));
    expect(res.status).toBe(400);
  });
});

describe('F2 - scan and alert workflow', () => {
  test('admin enables email alerts (PUT settings)', async () => {
    const res = await request(app).put('/api/alerts/settings').set(h.auth(admin))
      .send({ warning_days: 7, critical_days: 2, email_enabled: true, notify_emails: ['Manager@FoodBank.org'] });
    expect(res.status).toBe(200);
    expect(res.body.notify_emails).toEqual(['manager@foodbank.org']);
  });

  test('scan creates one alert per at-risk item and sends ONE digest email', async () => {
    const res = await request(app).post('/api/alerts/scan').set(h.auth(staff1));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 3, escalated: 0, active_alerts: 3, email: { sent: true } });
    expect(nodemailer.__sendMail).toHaveBeenCalledTimes(1);
    expect(nodemailer.__sendMail.mock.calls[0][0].subject).toMatch(/3 item\(s\).*1 expired/);
  });

  test('running the scan again creates no duplicates and sends no email', async () => {
    const res = await request(app).post('/api/alerts/scan').set(h.auth(staff1));
    expect(res.body).toMatchObject({ created: 0, active_alerts: 3 });
    expect(nodemailer.__sendMail).toHaveBeenCalledTimes(1);
  });

  test('escalates warning -> critical when the item gets closer to expiry', async () => {
    await h.query("UPDATE food_items SET expiry_date = CURRENT_DATE + 1 WHERE item_id = $1", [ids.warning]);
    const res = await request(app).post('/api/alerts/scan').set(h.auth(admin));
    expect(res.body).toMatchObject({ created: 1, escalated: 1, active_alerts: 3 });
    const list = await request(app).get('/api/alerts?level=critical').set(h.auth(staff1));
    expect(list.body.alerts.map((a) => a.name).sort()).toEqual(['Bananas', 'Yoghurt']);
  });

  test('auto-resolves an alert when Distribution gives out all the stock', async () => {
    await h.distribute('HH-001', staff1.id, [[ids.critical, 10]]); // all 10 yoghurts distributed
    const res = await request(app).post('/api/alerts/scan').set(h.auth(admin));
    expect(res.body).toMatchObject({ auto_resolved: 1, active_alerts: 2 });
    const resolved = await request(app).get('/api/alerts?status=resolved').set(h.auth(staff1));
    expect(resolved.body.alerts.find((a) => a.name === 'Yoghurt').resolution_action).toBe('stock_cleared');
  });

  test('GET /api/alerts/summary gives badge counts', async () => {
    const res = await request(app).get('/api/alerts/summary').set(h.auth(staff2));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ active: 2, expired: 1, critical: 1, warning: 0 });
  });
});

describe('F2 - PATCH /api/alerts/:id (status workflow + ownership)', () => {
  let expiredAlert; let bananaAlert;
  beforeAll(async () => {
    const res = await request(app).get('/api/alerts').set(h.auth(staff1));
    expiredAlert = res.body.alerts.find((a) => a.level === 'expired').alert_id;
    bananaAlert = res.body.alerts.find((a) => a.name === 'Bananas').alert_id;
  });

  test('staff1 acknowledges an alert', async () => {
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(staff1)).send({ status: 'acknowledged' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'acknowledged', acknowledged_by: staff1.id });
  });
  test('cannot acknowledge twice (409)', async () => {
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(staff1)).send({ status: 'acknowledged' });
    expect(res.status).toBe(409);
  });
  test('OWNERSHIP: staff2 cannot resolve an alert staff1 acknowledged (403)', async () => {
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(staff2))
      .send({ status: 'resolved', resolution_action: 'discarded' });
    expect(res.status).toBe(403);
  });
  test('RULE: expired food cannot be marked as distributed (409)', async () => {
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(staff1))
      .send({ status: 'resolved', resolution_action: 'distributed' });
    expect(res.status).toBe(409);
  });
  test('RULE: "other" needs a note (400)', async () => {
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(staff1))
      .send({ status: 'resolved', resolution_action: 'other' });
    expect(res.status).toBe(400);
  });
  test('INTEGRATION: if the inventory-service is down, the alert is NOT resolved (502, rolled back)', async () => {
    const { HttpError } = require('../src/utils/httpError');
    inventoryClient.setItemQuantity.mockRejectedValueOnce(new HttpError(502, 'Inventory service is unavailable'));
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(staff1))
      .send({ status: 'resolved', resolution_action: 'discarded' });
    expect(res.status).toBe(502);
    const { rows } = await h.query('SELECT status FROM expiry_alerts WHERE alert_id = $1', [expiredAlert]);
    expect(rows[0].status).toBe('acknowledged');
  });
  test('owner resolves it as discarded', async () => {
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(staff1))
      .send({ status: 'resolved', resolution_action: 'discarded', note: 'Past date, binned' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', resolution_action: 'discarded' });
  });
  test('INTEGRATION: discarding asks the inventory-service to set stock to 0 (with the user token)', async () => {
    expect(inventoryClient.setItemQuantity).toHaveBeenCalledWith(ids.expired, 0, staff1.token);
    const { rows } = await h.query('SELECT quantity FROM food_items WHERE item_id = $1', [ids.expired]);
    expect(rows[0].quantity).toBe(0);
    const scan = await request(app).post('/api/alerts/scan').set(h.auth(admin));
    expect(scan.body.created).toBe(0);
  });
  test('resolved alerts are final (409)', async () => {
    const res = await request(app).patch(`/api/alerts/${expiredAlert}`).set(h.auth(admin)).send({ status: 'acknowledged' });
    expect(res.status).toBe(409);
  });
  test('RULE: staff cannot discard food that has not expired (403)', async () => {
    const res = await request(app).patch(`/api/alerts/${bananaAlert}`).set(h.auth(staff2))
      .send({ status: 'resolved', resolution_action: 'discarded' });
    expect(res.status).toBe(403);
  });
  test('staff resolves a non-expired alert as distributed', async () => {
    const res = await request(app).patch(`/api/alerts/${bananaAlert}`).set(h.auth(staff2))
      .send({ status: 'resolved', resolution_action: 'distributed' });
    expect(res.status).toBe(200);
  });
  test('distributed does not call the inventory-service (Distribution already reduced the stock)', async () => {
    const itemsSentToInventory = inventoryClient.setItemQuantity.mock.calls.map((c) => c[0]);
    expect(itemsSentToInventory).not.toContain(ids.warning); // Bananas were resolved as distributed
  });
  test.each([
    [{ status: 'open' }],
    [{ status: 'acknowledged', resolution_action: 'discarded' }],
    [{ status: 'resolved' }],
    [{ status: 'resolved', resolution_action: 'eaten' }],
    [{ status: 'acknowledged', acknowledged_by: 1 }],
  ])('rejects invalid body %j with 400', async (body) => {
    const res = await request(app).patch(`/api/alerts/${bananaAlert}`).set(h.auth(staff1)).send(body);
    expect(res.status).toBe(400);
  });
  test('unknown alert id -> 404, bad id -> 400', async () => {
    expect((await request(app).patch('/api/alerts/99999').set(h.auth(staff1)).send({ status: 'acknowledged' })).status).toBe(404);
    expect((await request(app).patch('/api/alerts/abc').set(h.auth(staff1)).send({ status: 'acknowledged' })).status).toBe(400);
  });
});

describe('Settings validation', () => {
  test('staff cannot change settings (403)', async () => {
    const res = await request(app).put('/api/alerts/settings').set(h.auth(staff1))
      .send({ warning_days: 30, critical_days: 2, email_enabled: false, notify_emails: [] });
    expect(res.status).toBe(403);
  });
  test.each([
    [{ warning_days: 3, critical_days: 3, email_enabled: false, notify_emails: [] }],
    [{ warning_days: 7, critical_days: 2, email_enabled: true, notify_emails: [] }],
    [{ warning_days: 7, critical_days: 2, email_enabled: false, notify_emails: ['not-an-email'] }],
    [{ warning_days: 7, critical_days: 2, email_enabled: 'yes', notify_emails: [] }],
    [{ warning_days: 7 }],
  ])('admin gets 400 for %j', async (body) => {
    const res = await request(app).put('/api/alerts/settings').set(h.auth(admin)).send(body);
    expect(res.status).toBe(400);
  });
});
