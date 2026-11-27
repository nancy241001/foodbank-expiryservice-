// Expiry Alerts page (Nancy). All data comes from the real API.
const user = Api.requireLogin();
const isAdmin = user && user.role === 'admin';



// ---------- F2: alert list ----------
async function loadAlerts() {
  const tbody = document.getElementById('alertRows');
  try {
    const query = qs(document.getElementById('alertFilters'));
    const { alerts } = await Api.get(`/api/alerts${query ? `?${query}` : ''}`);
    tbody.replaceChildren(...(alerts.length ? alerts.map(alertRow) : [el('tr', {}, el('td', { colspan: 9 }, 'No alerts match these filters.'))]));
  } catch (err) {
    tbody.replaceChildren(el('tr', {}, el('td', { colspan: 9 }, `Could not load alerts: ${err.message}`)));
  }
}

function alertRow(a) {
  const actions = el('td', { class: 'actions' });
  if (a.status === 'open') {
    actions.append(el('button', { type: 'button', onclick: () => acknowledge(a) }, 'Acknowledge'));
  }
  if (a.status !== 'resolved') {
    // The API decides who may resolve. We only grey out the obvious case to help the user.
    const notMine = a.status === 'acknowledged' && a.acknowledged_by !== user.id && !isAdmin;
    const btn = el('button', { type: 'button', class: 'secondary', onclick: () => openResolve(a) }, 'Resolve');
    if (notMine) { btn.disabled = true; btn.title = `Acknowledged by ${a.acknowledged_by_name}`; }
    actions.append(btn);
  } else {
    actions.append(el('span', { class: 'muted' }, `${a.resolution_action}${a.resolution_note ? `: ${a.resolution_note}` : ''}`));
  }
  return el('tr', { class: a.level },
    el('td', {}, levelPill(a.level)), el('td', {}, a.name), el('td', {}, a.category),
    el('td', {}, `${a.current_quantity} ${a.unit}`), el('td', {}, a.expiry_date), el('td', {}, daysText(a.days_left)),
    el('td', {}, a.status), el('td', {}, a.acknowledged_by_name || '-'), actions);
}

async function acknowledge(a) {
  try {
    await Api.patch(`/api/alerts/${a.alert_id}`, { status: 'acknowledged' });
    showMessage('msg', `You are now handling "${a.name}".`, 'success');
    await refreshAll();
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

// ---------- resolve dialog ----------
const dialog = document.getElementById('resolveDialog');
const resolveForm = document.getElementById('resolveForm');
let resolving = null;

function openResolve(a) {
  resolving = a;
  resolveForm.reset();
  document.getElementById('resolveItem').textContent = `${a.name} (${a.level})`;
  // Mirror the API's food-safety rules in the form so the user is not surprised.
  resolveForm.resolution_action.querySelector('[value=distributed]').disabled = a.level === 'expired';
  resolveForm.resolution_action.querySelector('[value=discarded]').disabled = a.level !== 'expired' && !isAdmin;
  resolveForm.resolution_action.value = a.level === 'expired' ? 'discarded' : 'distributed';
  showMessage('resolveMsg', '');
  dialog.showModal();
}
document.getElementById('resolveCancel').addEventListener('click', () => dialog.close());

resolveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const action = resolveForm.resolution_action.value;
  const note = resolveForm.note.value.trim();
  if (action === 'other' && !note) return showMessage('resolveMsg', 'Please explain what happened in the note.', 'error');
  try {
    await Api.patch(`/api/alerts/${resolving.alert_id}`, { status: 'resolved', resolution_action: action, ...(note ? { note } : {}) });
    dialog.close();
    showMessage('msg', `Alert for "${resolving.name}" resolved.`, 'success');
    await refreshAll();
  } catch (err) { showMessage('resolveMsg', err.message, 'error'); }
});

// ---------- run scan ----------
document.getElementById('scanBtn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const s = await Api.post('/api/alerts/scan');
    const mail = s.email.sent ? 'Email sent to staff.' : `No email (${s.email.reason}).`;
    showMessage('msg', `Scan done: ${s.created} new, ${s.escalated} escalated, ${s.auto_resolved} closed automatically. ${s.active_alerts} active. ${mail}`, 'success');
    await refreshAll();
  } catch (err) { showMessage('msg', err.message, 'error'); } finally { e.target.disabled = false; }
});

// ---------- F1: look-up ----------
async function lookup() {
  const form = document.getElementById('lookupForm');
  const days = form.days.value;
  if (days && (days < 1 || days > 90)) return showMessage('msg', 'Days must be between 1 and 90', 'error');
  try {
    const q = qs(form);
    const data = await Api.get(`/api/alerts/expiry${q ? `?${q}` : ''}`);
    document.getElementById('lookupInfo').textContent = `${data.count} item(s) expire within ${data.window_days} day(s). Hand these out first.`;
    document.getElementById('lookupRows').replaceChildren(...data.items.map((i) => el('tr', { class: i.level },
      el('td', {}, levelPill(i.level)), el('td', {}, i.name), el('td', {}, i.category), el('td', {}, `${i.quantity} ${i.unit}`),
      el('td', {}, i.expiry_date), el('td', {}, daysText(i.days_left)), el('td', {}, i.storage_location || '-'),
      el('td', {}, i.has_active_alert ? 'Yes' : 'Not yet - run scan'))));
  } catch (err) { showMessage('msg', err.message, 'error'); }
}

// ---------- settings ----------
async function loadSettings() {
  const f = document.getElementById('settingsForm');
  const s = await Api.get('/api/alerts/settings');
  f.warning_days.value = s.warning_days;
  f.critical_days.value = s.critical_days;
  f.email_enabled.checked = s.email_enabled;
  f.notify_emails.value = s.notify_emails.join(', ');
  if (!isAdmin) {
    [...f.elements].forEach((x) => { x.disabled = true; });
    document.getElementById('settingsNote').textContent = 'Only an admin can change these settings.';
  }
}
document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    warning_days: Number(f.warning_days.value),
    critical_days: Number(f.critical_days.value),
    email_enabled: f.email_enabled.checked,
    notify_emails: f.notify_emails.value.split(',').map((s) => s.trim()).filter(Boolean),
  };
  if (body.critical_days >= body.warning_days) return showMessage('msg', 'Critical days must be smaller than the warning window', 'error');
  try {
    await Api.put('/api/alerts/settings', body);
    showMessage('msg', 'Settings saved.', 'success');
    await lookup();
  } catch (err) { showMessage('msg', err.message, 'error'); }
});

document.getElementById('alertFilters').addEventListener('submit', (e) => { e.preventDefault(); loadAlerts(); });
document.getElementById('lookupForm').addEventListener('submit', (e) => { e.preventDefault(); lookup(); });

async function refreshAll() {
  await Promise.all([loadAlerts(), lookup()]);
  if (window.refreshAlertBadge) window.refreshAlertBadge();
}
if (user) { refreshAll(); loadSettings().catch((err) => showMessage('msg', err.message, 'error')); }
