// Routes for Reporting. All require login + staff/admin role.
// Ownership of saved exports is checked inside exportService (staff: own only, admin: all).
const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/auth');
const c = require('./reportController');

const router = express.Router();
router.use(requireAuth, requireRole('staff', 'admin'));

router.get('/inventory', c.inventory);         // F3 inventory summary (filter: category, from, to)
router.get('/distributions', c.distributions); // F3 distribution summary
router.get('/waste', c.waste);                 // F3 waste vs saved summary
router.get('/dashboard', c.dashboard);         // tiles for the shared dashboard

router.post('/exports', c.createExport);           // F4 export a filtered report to S3
router.get('/exports', c.listExports);             // F4 list saved exports
router.get('/exports/:id/download', c.download);   // F4 short-lived download link
router.delete('/exports/:id', c.deleteExport);     // F4 delete an export

module.exports = router;
