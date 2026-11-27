// Unit tests for the HTTP call to Mohamed's inventory-service (fetch is faked).
const { setItemQuantity } = require('../src/clients/inventoryClient');

afterEach(() => { delete global.fetch; });
const fakeFetch = (impl) => { global.fetch = jest.fn(impl); return global.fetch; };

test('sends PATCH /api/items/:id with quantity and the user token', async () => {
  const f = fakeFetch(async () => ({ ok: true, status: 200 }));
  await setItemQuantity(7, 0, 'user-token');
  const [url, opts] = f.mock.calls[0];
  expect(url).toBe('http://inventory.test.local/api/items/7');
  expect(opts.method).toBe('PATCH');
  expect(opts.headers.Authorization).toBe('Bearer user-token');
  expect(JSON.parse(opts.body)).toEqual({ quantity: 0 });
});
test.each([[404, 404], [403, 403], [401, 403], [500, 502]])('inventory answers %i -> we return %i', async (theirs, ours) => {
  fakeFetch(async () => ({ ok: false, status: theirs }));
  await expect(setItemQuantity(7, 0, 't')).rejects.toMatchObject({ status: ours });
});
test('inventory unreachable / timeout -> 502', async () => {
  fakeFetch(async () => { throw new Error('ECONNREFUSED'); });
  await expect(setItemQuantity(7, 0, 't')).rejects.toMatchObject({ status: 502 });
});
