// Calls Mohamed's inventory-service over HTTP.
// Why: with separate backends, each service is the only one allowed to CHANGE its own data.
// Nancy's service may READ food_items for reports, but stock changes go through Inventory's API,
// so Inventory's own validation and logging still apply.
const config = require('../config');
const { HttpError } = require('../utils/httpError');
const logger = require('../utils/logger');

// Agreed contract with Mohamed (proposal 5.1): PATCH /api/items/{id}  { "quantity": <int> }
// The user's own token is forwarded, so Inventory applies its own role checks to the same user.
async function setItemQuantity(itemId, quantity, userToken) {
  const url = `${config.inventoryApiUrl}/api/items/${encodeURIComponent(itemId)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ quantity }),
      signal: AbortSignal.timeout(5000), // never hang a request because another service is slow
    });
  } catch (err) {
    logger.error('INVENTORY_SERVICE_UNREACHABLE', { itemId, message: err.message });
    throw new HttpError(502, 'Inventory service is unavailable, so the stock could not be updated. Try again shortly.');
  }
  if (res.ok) return;
  logger.warn('INVENTORY_SERVICE_REFUSED', { itemId, status: res.status });
  if (res.status === 404) throw new HttpError(404, 'This item no longer exists in the inventory');
  if (res.status === 401 || res.status === 403) throw new HttpError(403, 'The inventory service did not allow this stock change');
  throw new HttpError(502, 'Inventory service could not update the stock');
}

module.exports = { setItemQuantity };
