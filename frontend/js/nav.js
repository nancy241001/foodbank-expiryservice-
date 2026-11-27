// Shared navigation bar, injected on every page, with Nancy's live alert badge.
// The badge is the "dashboard/notification integration": every page shows how many alerts are open.
(function buildNav() {
  const user = Api.getUser();
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const links = [
    ['index.html', 'Dashboard'],
    ['inventory.html', 'Inventory'],        // Mohamed
    ['distribution.html', 'Distribution'],  // Momen
    ['alerts.html', 'Expiry Alerts'],       // Nancy
    ['reports.html', 'Reports'],            // Nancy
  ];
  if (user && user.role === 'admin') links.push(['users.html', 'Users']); // Momen (admin only; the API enforces it too)
  const badge = el('span', { class: 'badge', id: 'alertBadge', hidden: '' });
  const nav = el('nav', { class: 'topnav' },
    el('strong', { class: 'brand' }, 'Food Bank'),
    ...links.map(([href, label]) => {
      const a = el('a', { href, class: href === page ? 'active' : '' }, label);
      if (href === 'alerts.html') a.append(' ', badge);
      return a;
    }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'who' }, user ? `${user.name} (${user.role})` : ''),
    el('button', { class: 'link', type: 'button', onclick: Api.logout }, 'Log out'),
  );
  document.body.prepend(nav);

  async function refreshBadge() {
    try {
      const s = await Api.get('/api/alerts/summary');
      badge.textContent = s.active;
      badge.hidden = s.active === 0;
      badge.className = `badge ${s.expired > 0 ? 'expired' : s.critical > 0 ? 'critical' : 'warning'}`;
      badge.title = `${s.expired} expired, ${s.critical} critical, ${s.warning} warning`;
    } catch { /* badge is optional; the page still works */ }
  }
  if (user) { refreshBadge(); setInterval(refreshBadge, 60000); }
  window.refreshAlertBadge = refreshBadge;
})();
