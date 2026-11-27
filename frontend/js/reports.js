// Reports page (Nancy).
const user = Api.requireLogin();
const form = document.getElementById('reportForm');


// What each report shows: tile labels and table columns.
const VIEWS = {
  inventory: {
    hint: 'Dates filter by donation date. Leave empty for all current stock.',
    tiles: [['total_quantity', 'Units in stock'], ['expiring_soon_quantity', 'Expiring soon'], ['expired_quantity', 'Expired'], ['at_risk_percent', '% at risk']],
    cols: [['category', 'Category'], ['item_lines', 'Item lines'], ['total_quantity', 'Quantity'], ['expiring_soon_quantity', 'Expiring soon'], ['expired_quantity', 'Expired'], ['next_expiry', 'Next expiry']],
  },
  distributions: {
    hint: 'Dates filter by distribution date. Default: last 30 days.',
    tiles: [['distributions', 'Distributions'], ['families_served', 'Families served'], ['quantity', 'Units given out']],
    cols: [['category', 'Category'], ['distributions', 'Distributions'], ['families_served', 'Families'], ['quantity', 'Units']],
  },
  waste: {
    hint: 'Dates filter by when the alert was closed. Default: last 30 days.',
    tiles: [['saved_quantity', 'Units saved'], ['wasted_quantity', 'Units wasted'], ['transferred_quantity', 'Transferred'], ['waste_rate_percent', 'Waste rate %']],
    cols: [['category', 'Category'], ['saved_quantity', 'Saved'], ['wasted_quantity', 'Wasted'], ['transferred_quantity', 'Transferred'], ['alerts_closed', 'Alerts closed']],
  },
};

function filtersFromForm() {
  const f = { category: form.category.value, from: form.from.value, to: form.to.value };
  if (f.from && f.to && f.from > f.to) throw new Error('"From" must be on or before "To"');
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v));
}

async function showReport() {
  const type = form.type.value;
  const view = VIEWS[type];
  document.getElementById('dateHint').textContent = view.hint;
  try {
    const q = new URLSearchParams(filtersFromForm()).toString();
    const data = await Api.get(`/api/reports/${type}${q ? `?${q}` : ''}`);
    document.getElementById('tiles').replaceChildren(...view.tiles.map(([k, label]) =>
      el('div', { class: 'tile' }, el('div', { class: 'tile-value' }, String(data.totals[k] ?? 0)), el('div', { class: 'tile-label' }, label))));
    const table = document.getElementById('reportTable');
    const head = el('thead', {}, el('tr', {}, ...view.cols.map(([, l]) => el('th', {}, l))));
    const rows = data.by_category.length
      ? data.by_category.map((r) => el('tr', {}, ...view.cols.map(([k]) => el('td', {}, r[k] ?? '-'))))
      : [el('tr', {}, el('td', { colspan: view.cols.length }, 'No data for these filters.'))];
    table.replaceChildren(head, el('tbody', {}, ...rows));
    if (type === 'distributions' && data.top_items.length) {
      table.append(el('caption', {}, `Top items: ${data.top_items.map((t) => `${t.name} (${t.quantity})`).join(', ')}`));
    }
    showMessage('msg', '');
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

async function loadExports() {
  const tbody = document.getElementById('exportRows');
  try {
    const { exports } = await Api.get('/api/reports/exports');
    tbody.replaceChildren(...(exports.length ? exports.map((x) => el('tr', {},
      el('td', {}, x.report_id), el('td', {}, x.report_type),
      el('td', {}, Object.entries(x.filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'),
      el('td', {}, x.row_count), el('td', {}, new Date(x.created_at).toLocaleString()), el('td', {}, x.owner_name),
      el('td', { class: 'actions' },
        el('button', { type: 'button', onclick: () => download(x.report_id) }, 'Download'),
        el('button', { type: 'button', class: 'danger', onclick: () => removeExport(x.report_id) }, 'Delete')),
    )) : [el('tr', {}, el('td', { colspan: 7 }, 'No saved exports yet.'))]));
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

async function download(id) {
  try {
    const { url } = await Api.get(`/api/reports/exports/${id}/download`);
    window.location.href = url; // short-lived pre-signed S3 link
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

async function removeExport(id) {
  if (!window.confirm(`Delete export #${id}? The file will be removed from storage.`)) return;
  try {
    await Api.del(`/api/reports/exports/${id}`);
    showMessage('msg', `Export #${id} deleted.`, 'success');
    loadExports();
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const saved = await Api.post('/api/reports/exports', { type: form.type.value, ...filtersFromForm() });
    showMessage('msg', `Export #${saved.report_id} saved (${saved.row_count} rows).`, 'success');
    loadExports();
  } catch (err) { showMessage('msg', err.message, 'error'); }
});
form.addEventListener('submit', (e) => { e.preventDefault(); showReport(); });
form.type.addEventListener('change', showReport);

if (user) { showReport(); loadExports(); }
