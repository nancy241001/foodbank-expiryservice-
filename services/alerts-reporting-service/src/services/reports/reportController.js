// HTTP layer for reports and exports.
const v = require('../../utils/validate');
const { CATEGORIES, REPORT_TYPES } = require('../../constants');
const reports = require('./reportService');
const exportsSvc = require('./exportService');

const handle = (fn) => (req, res, next) => fn(req, res).catch(next);

// Shared filter parsing: ?category=&from=YYYY-MM-DD&to=YYYY-MM-DD
function parseFilters(src) {
  const category = v.oneOf(src.category, 'category', CATEGORIES, { optional: true });
  const { from, to } = v.dateRange(src.from, src.to);
  return { category, from, to };
}

module.exports = {
  inventory: handle(async (req, res) => res.json(await reports.inventorySummary(parseFilters(req.query)))),
  distributions: handle(async (req, res) => res.json(await reports.distributionSummary(parseFilters(req.query)))),
  waste: handle(async (req, res) => res.json(await reports.wasteSummary(parseFilters(req.query)))),
  dashboard: handle(async (req, res) => res.json(await reports.dashboard())),

  // POST /api/reports/exports  { type, category?, from?, to? }
  createExport: handle(async (req, res) => {
    const body = v.onlyFields(req.body, ['type', 'category', 'from', 'to']);
    const type = v.oneOf(body.type, 'type', REPORT_TYPES);
    const saved = await exportsSvc.createExport(req.user, type, parseFilters(body));
    res.status(201).json(saved);
  }),
  listExports: handle(async (req, res) => {
    const rows = await exportsSvc.listExports(req.user);
    res.json({ count: rows.length, exports: rows });
  }),
  download: handle(async (req, res) => {
    res.json(await exportsSvc.downloadLink(req.user, v.positiveId(req.params.id, 'report id')));
  }),
  deleteExport: handle(async (req, res) => {
    await exportsSvc.deleteExport(req.user, v.positiveId(req.params.id, 'report id'));
    res.status(204).end();
  }),
};
