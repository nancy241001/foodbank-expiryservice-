// DEMO MODE (opt-in). Open any page with ?demo=1 to browse Nancy's Alerts and Reports pages
// with sample data, no login and no backend. Real mode is untouched: without ?demo=1 nothing here runs.
// The data below is made up for screenshots/demos; it is not test evidence.
(function () {
  if (new URLSearchParams(location.search).get('demo') === '1') sessionStorage.setItem('fb_demo', '1');
  if (location.search.includes('demo=0')) sessionStorage.removeItem('fb_demo');
  if (sessionStorage.getItem('fb_demo') !== '1') return;

  const day = 86400000;
  const iso = (n) => new Date(Date.now() + n * day).toISOString().slice(0, 10);
  const USER = { id: 1, name: 'Demo Admin', role: 'admin' };
  const mk = (id, name, category, qty, unit, days, status, by, loc) => ({
    alert_id: id, name, category, current_quantity: qty, quantity: qty, unit, expiry_date: iso(days), days_left: days,
    level: days < 0 ? 'expired' : days <= 2 ? 'critical' : 'warning', status,
    acknowledged_by: by ? 1 : null, acknowledged_by_name: by || null, storage_location: loc, has_active_alert: true,
  });
  const alerts = [
    mk(1, 'Whole milk 1L', 'dairy', 24, 'bottles', -1, 'open', null, 'Fridge A'),
    mk(2, 'White bread', 'bakery', 40, 'loaves', 1, 'open', null, 'Shelf B2'),
    mk(3, 'Yogurt cups', 'dairy', 60, 'cups', 2, 'acknowledged', 'Demo Admin', 'Fridge A'),
    mk(4, 'Tomatoes', 'fresh', 18, 'kg', 4, 'open', null, 'Cold room'),
    mk(5, 'Canned beans', 'canned', 120, 'cans', 6, 'open', null, 'Shelf C1'),
    mk(6, 'Cheddar cheese', 'dairy', 15, 'blocks', 7, 'acknowledged', 'Demo Admin', 'Fridge B'),
  ];
  const settings = { warning_days: 7, critical_days: 2, email_enabled: false, notify_emails: ['staff@example.org'] };
  let nextExport = 1;
  const exportsList = [];

  const reports = {
    inventory: { totals: { total_quantity: 640, expiring_soon_quantity: 157, expired_quantity: 24, at_risk_percent: 28 }, by_category: [
      { category: 'dairy', item_lines: 3, total_quantity: 99, expiring_soon_quantity: 75, expired_quantity: 24, next_expiry: iso(-1) },
      { category: 'bakery', item_lines: 1, total_quantity: 40, expiring_soon_quantity: 40, expired_quantity: 0, next_expiry: iso(1) },
      { category: 'fresh', item_lines: 2, total_quantity: 60, expiring_soon_quantity: 18, expired_quantity: 0, next_expiry: iso(4) },
      { category: 'canned', item_lines: 4, total_quantity: 441, expiring_soon_quantity: 24, expired_quantity: 0, next_expiry: iso(6) }] },
    distributions: { totals: { distributions: 42, families_served: 120, quantity: 530 }, top_items: [{ name: 'Rice', quantity: 140 }, { name: 'Bread', quantity: 95 }],
      by_category: [{ category: 'dry', distributions: 20, families_served: 60, quantity: 260 }, { category: 'bakery', distributions: 12, families_served: 35, quantity: 150 }, { category: 'dairy', distributions: 10, families_served: 25, quantity: 120 }] },
    waste: { totals: { saved_quantity: 310, wasted_quantity: 22, transferred_quantity: 40, waste_rate_percent: 6 }, by_category: [
      { category: 'dairy', saved_quantity: 120, wasted_quantity: 12, transferred_quantity: 10, alerts_closed: 9 },
      { category: 'bakery', saved_quantity: 90, wasted_quantity: 10, transferred_quantity: 20, alerts_closed: 7 },
      { category: 'fresh', saved_quantity: 100, wasted_quantity: 0, transferred_quantity: 10, alerts_closed: 5 }] },
  };

  const summary = () => {
    const act = alerts.filter((a) => a.status !== 'resolved');
    return { active: act.length, expired: act.filter((a) => a.level === 'expired').length,
      critical: act.filter((a) => a.level === 'critical').length, warning: act.filter((a) => a.level === 'warning').length };
  };
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };

  function handle(method, path, body) {
    const [p, query = ''] = path.split('?');
    const q = new URLSearchParams(query);
    if (p === '/api/reports/dashboard') {
      const sm = summary();
      return { alerts: { expired: sm.expired, critical: sm.critical, warning: sm.warning },
        stock: { total_quantity: 640, expiring_soon_quantity: 157, at_risk_percent: 28 },
        last_7_days: { distributions: 12, families_served: 38, quantity: 160 } };
    }
    if (p === '/api/alerts/summary') return summary();
    if (p === '/api/alerts/settings') { if (method === 'PUT') Object.assign(settings, body); return { ...settings }; }
    if (p === '/api/alerts/scan') return { created: 0, escalated: 1, auto_resolved: 0, active_alerts: summary().active, email: 'disabled' };
    if (p === '/api/alerts/expiry') {
      const d = Number(q.get('days') || settings.warning_days);
      const items = alerts.filter((a) => a.days_left <= d && (!q.get('category') || a.category === q.get('category')));
      return { count: items.length, window_days: d, items };
    }
    if (p === '/api/alerts' && method === 'GET') {
      const st = q.get('status');
      const list = alerts.filter((a) => (st ? a.status === st : a.status !== 'resolved')
        && (!q.get('level') || a.level === q.get('level')) && (!q.get('category') || a.category === q.get('category')));
      return { alerts: list.filter((a) => (st ? a.status === st : true) || !st) };
    }
    const m = p.match(/^\/api\/alerts\/(\d+)$/);
    if (m && method === 'PATCH') {
      const a = alerts.find((x) => x.alert_id === Number(m[1]));
      if (body.status === 'acknowledged') { a.status = 'acknowledged'; a.acknowledged_by = 1; a.acknowledged_by_name = USER.name; }
      if (body.status === 'resolved') { a.status = 'resolved'; a.resolution_action = body.resolution_action; a.resolution_note = body.note; }
      return a;
    }
    const r = p.match(/^\/api\/reports\/(inventory|distributions|waste)$/);
    if (r) { const d = JSON.parse(JSON.stringify(reports[r[1]])); if (q.get('category')) d.by_category = d.by_category.filter((x) => x.category === q.get('category')); return d; }
    if (p === '/api/reports/exports' && method === 'GET') return { exports: exportsList };
    if (p === '/api/reports/exports' && method === 'POST') {
      const x = { report_id: nextExport++, report_type: body.type, filters: { category: body.category, from: body.from, to: body.to },
        row_count: reports[body.type].by_category.length, created_at: new Date().toISOString(), owner_name: USER.name };
      exportsList.push(x); return x;
    }
    const e = p.match(/^\/api\/reports\/exports\/(\d+)(\/download)?$/);
    if (e && method === 'DELETE') { exportsList.splice(exportsList.findIndex((x) => x.report_id === Number(e[1])), 1); return null; }
    if (e && e[2]) bad('Demo mode: downloads are disabled.');
    bad('Demo mode: this page needs a teammate’s backend.');
  }

  window.DEMO = { user: USER, handle };
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.textContent = 'DEMO MODE: sample data, no login, no backend. Add ?demo=0 to the address to leave.';
    b.style.cssText = 'background:#fff3cd;color:#664d03;text-align:center;padding:6px;font:14px sans-serif';
    document.body.prepend(b);
  });
})();
