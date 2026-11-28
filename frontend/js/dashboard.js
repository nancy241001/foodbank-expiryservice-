const tiles = (id, pairs) => document.getElementById(id).replaceChildren(...pairs.map(([v, l, cls = '']) =>
  el('div', { class: `tile ${cls}` }, el('div', { class: 'tile-value' }, String(v ?? 0)), el('div', { class: 'tile-label' }, l))));

(async () => {
  if (!Api.requireLogin()) return;
  try {
    const d = await Api.get('/api/reports/dashboard');
    tiles('alertTiles', [[d.alerts.expired, 'Expired', 'expired'], [d.alerts.critical, 'Critical', 'critical'], [d.alerts.warning, 'Warning', 'warning']]);
    tiles('stockTiles', [[d.stock.total_quantity, 'Units in stock'], [d.stock.expiring_soon_quantity, 'Expiring soon'], [d.stock.at_risk_percent, '% at risk']]);
    tiles('weekTiles', [[d.last_7_days.distributions, 'Distributions'], [d.last_7_days.families_served, 'Families served'], [d.last_7_days.quantity, 'Units given out']]);
  } catch (err) { showMessage('msg', err.message, 'error'); }
})();
