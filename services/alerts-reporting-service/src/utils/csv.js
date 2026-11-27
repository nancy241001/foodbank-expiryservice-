// Turns rows into CSV text for report exports.
// Security: a cell starting with = + - @ can run as a formula when opened in Excel
// ("CSV injection"), so such cells are prefixed with a single quote.
function safeCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(columns, rows) {
  const header = columns.map(safeCell).join(',');
  const lines = rows.map((row) => columns.map((c) => safeCell(row[c])).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}

module.exports = { toCsv, safeCell };
