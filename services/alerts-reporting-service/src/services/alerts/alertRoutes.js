// Routes for Expiry Alerts. Every route requires login (requireAuth) and a role check (requireRole).
// The checks run on the server, so hiding a button in the browser is not what protects the data.
const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('./alertController');

const router = express.Router();
const staffOrAdmin = requireRole('staff', 'admin');
const adminOnly = requireRole('admin');

router.use(requireAuth);

router.get('/expiry', staffOrAdmin, c.expiring);      // F1 look up items about to expire
router.get('/summary', staffOrAdmin, c.summary);      // badge counts for the navigation bar
router.get('/settings', staffOrAdmin, c.getSettings); // everyone can see the thresholds
router.put('/settings', adminOnly, c.putSettings);    // only admin can change thresholds and recipients
router.post('/scan', staffOrAdmin, c.scan);           // F2 run the alert scan now
router.get('/', staffOrAdmin, c.list);                // F2 view alerts
router.patch('/:id', staffOrAdmin, c.updateStatus);   // F2 acknowledge / resolve (ownership checked in service)

module.exports = router;
