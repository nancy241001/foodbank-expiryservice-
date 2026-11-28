// Where each student's backend lives. One shared frontend, three separate backends.
// Local defaults below; for the deployed version, put each API Gateway URL here.
// The frontend itself is static files (served on :3000 locally, e.g. `npx serve frontend -l 3000`).
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.SERVICES = window.SERVICES || (isLocal
  ? {
      inventory: 'http://localhost:3001',     // Mohamed - inventory-service
      distribution: 'http://localhost:3002',  // Momen - distribution-service (also login and users)
      alerts: 'http://localhost:3003',        // Nancy - alerts-reporting-service
    }
  : {
      // Deployed (Vercel). Replace the two .invalid addresses when those backends are published.
      inventory: 'https://inventory-service.not-deployed-yet.invalid',
      distribution: 'https://distribution-service.not-deployed-yet.invalid',
      alerts: 'https://foodbank-alerts.vercel.app',
    });

// Which backend owns which URL prefix.
window.ROUTES = [
  ['/api/auth', 'distribution'],
  ['/api/users', 'distribution'],
  ['/api/items', 'inventory'],
  ['/api/families', 'distribution'],
  ['/api/distributions', 'distribution'],
  ['/api/alerts', 'alerts'],
  ['/api/reports', 'alerts'],
];
