// HTTP layer for alerts: read and validate the request, call the service, send the response.
const v = require('../../utils/validate');
const { HttpError } = require('../../utils/httpError');
const { CATEGORIES, ALERT_LEVELS, ALERT_STATUSES, RESOLUTION_ACTIONS } = require('../../constants');
const service = require('./alertService');

// Wraps async handlers so any thrown error reaches the central error handler.
const handle = (fn) => (req, res, next) => fn(req, res).catch(next);

module.exports = {
  // GET /api/alerts/expiry?days=7&category=dairy
  expiring: handle(async (req, res) => {
    const days = v.intInRange(req.query.days, 'days', 1, 90, null) ?? undefined;
    const category = v.oneOf(req.query.category, 'category', CATEGORIES, { optional: true });
    res.json(await service.getExpiringItems({ days, category }));
  }),

  // POST /api/alerts/scan
  scan: handle(async (req, res) => {
    v.onlyFields(req.body || {}, []);
    res.status(201).json(await service.runScan({ trigger: 'manual', userId: req.user.id }));
  }),

  // GET /api/alerts?status=open&level=critical&category=dairy
  list: handle(async (req, res) => {
    const status = v.oneOf(req.query.status, 'status', ALERT_STATUSES, { optional: true });
    const level = v.oneOf(req.query.level, 'level', ALERT_LEVELS, { optional: true });
    const category = v.oneOf(req.query.category, 'category', CATEGORIES, { optional: true });
    const alerts = await service.listAlerts({ status, level, category });
    res.json({ count: alerts.length, alerts });
  }),

  // GET /api/alerts/summary
  summary: handle(async (req, res) => {
    res.json(await service.getAlertCounts());
  }),

  // PATCH /api/alerts/:id   { status, resolution_action?, note? }
  updateStatus: handle(async (req, res) => {
    const id = v.positiveId(req.params.id, 'alert id');
    const body = v.onlyFields(req.body, ['status', 'resolution_action', 'note']);
    const status = v.oneOf(body.status, 'status', ['acknowledged', 'resolved']);
    let resolution_action;
    if (status === 'resolved') resolution_action = v.oneOf(body.resolution_action, 'resolution_action', RESOLUTION_ACTIONS);
    else if (body.resolution_action !== undefined) throw new HttpError(400, 'resolution_action is only allowed when resolving');
    const note = v.optionalText(body.note, 'note', 300);
    res.json(await service.updateAlertStatus(id, { status, resolution_action, note }, { ...req.user, token: req.token }));
  }),

  // GET /api/alerts/settings
  getSettings: handle(async (req, res) => {
    res.json(await service.getSettings());
  }),

  // PUT /api/alerts/settings  (full replacement, so every field is required)
  putSettings: handle(async (req, res) => {
    const body = v.onlyFields(req.body, ['warning_days', 'critical_days', 'email_enabled', 'notify_emails']);
    const warning_days = v.intInRange(body.warning_days, 'warning_days', 1, 90);
    const critical_days = v.intInRange(body.critical_days, 'critical_days', 0, 30);
    if (typeof body.email_enabled !== 'boolean') throw new HttpError(400, 'email_enabled must be true or false');
    const notify_emails = v.emailList(body.notify_emails, 'notify_emails');
    res.json(await service.updateSettings({ warning_days, critical_days, email_enabled: body.email_enabled, notify_emails }, req.user.id));
  }),
};
