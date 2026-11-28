// Shared fetch helper used by every page.
// - adds the login token to each request
// - turns error responses into readable messages
// - sends the user back to login on 401
const Api = (() => {
  const TOKEN_KEY = 'fb_token';
  const USER_KEY = 'fb_user';

  // sessionStorage: the token disappears when the tab is closed (safer than localStorage on shared PCs).
  const getToken = () => (window.DEMO ? 'demo' : sessionStorage.getItem(TOKEN_KEY));
  const getUser = () => (window.DEMO ? window.DEMO.user : JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'));

  function saveLogin({ token, user }) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function logout() {
    sessionStorage.clear();
    window.location.href = 'login.html';
  }

  // Picks the backend that owns this path (see config.js), e.g. /api/alerts -> Nancy's service.
  function baseUrlFor(path) {
    const match = window.ROUTES.find(([prefix]) => path.startsWith(prefix));
    if (!match) throw new Error(`No backend configured for ${path}`);
    return window.SERVICES[match[1]];
  }

  async function request(method, path, body) {
    if (window.DEMO) return window.DEMO.handle(method, path, body); // demo mode only (see js/demo.js)
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `${baseUrlFor(path)}${path}`; // outside try: a missing route is a config bug, not a network error
    let res;
    try {
      res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('Cannot reach that service. It may be down - other pages can still work.');
    }
    if (res.status === 401 && !path.startsWith('/api/auth')) { logout(); throw new Error('Please log in again'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Pages call this first: no token -> go to login.
  function requireLogin() {
    if (!getToken()) { window.location.href = 'login.html'; return null; }
    return getUser();
  }

  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b || {}),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    saveLogin, logout, requireLogin, getUser,
  };
})();

// Small DOM helpers. el() always uses textContent, never innerHTML, so data from the
// server (item names typed by staff) can never run as HTML/JavaScript (prevents XSS).
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return node;
}

function showMessage(target, text, type = 'info') {
  const box = typeof target === 'string' ? document.getElementById(target) : target;
  box.textContent = text;
  box.className = `message ${type}`;
  box.hidden = !text;
}
