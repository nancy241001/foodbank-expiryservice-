document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) return showMessage('msg', 'Enter your email and password', 'error');
  try {
    const data = await Api.post('/api/auth/login', { email, password });
    Api.saveLogin(data);
    window.location.href = 'alerts.html';
  } catch (err) {
    showMessage('msg', err.message, 'error');
  }
});
