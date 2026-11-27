// Small input validators. Each one either returns a clean value or throws a 400.
// Validation happens on the server because anyone can bypass the browser form.
const { HttpError } = require('./httpError');

const bad = (msg) => new HttpError(400, msg);

function positiveId(value, name = 'id') {
  if (!/^\d{1,9}$/.test(String(value)) || Number(value) < 1) throw bad(`${name} must be a positive whole number`);
  return Number(value);
}

function intInRange(value, name, min, max, fallback) {
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw bad(`${name} is required`);
  }
  if (!/^-?\d+$/.test(String(value))) throw bad(`${name} must be a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}

function oneOf(value, name, allowed, { optional = false } = {}) {
  if (value === undefined || value === '') {
    if (optional) return undefined;
    throw bad(`${name} is required`);
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw bad(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

// Accepts YYYY-MM-DD and rejects impossible dates such as 2026-02-31.
function isoDate(value, name, { optional = true } = {}) {
  if (value === undefined || value === '') {
    if (optional) return undefined;
    throw bad(`${name} is required`);
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`${name} must be a date in YYYY-MM-DD format`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw bad(`${name} is not a real date`);
  return value;
}

// from/to pair: from must not be after to, and the range is capped at one year
// so one request cannot make the database scan years of history.
function dateRange(from, to) {
  const f = isoDate(from, 'from');
  const t = isoDate(to, 'to');
  if (f && t) {
    if (f > t) throw bad('from must be on or before to');
    const days = (new Date(t) - new Date(f)) / 86400000;
    if (days > 366) throw bad('date range cannot be longer than 366 days');
  }
  return { from: f, to: t };
}

function optionalText(value, name, maxLen) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw bad(`${name} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > maxLen) throw bad(`${name} must be at most ${maxLen} characters`);
  return trimmed;
}

function emailList(value, name, maxItems = 10) {
  if (!Array.isArray(value)) throw bad(`${name} must be a list of email addresses`);
  if (value.length > maxItems) throw bad(`${name} can contain at most ${maxItems} addresses`);
  const re = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,}$/;
  return value.map((e) => {
    if (typeof e !== 'string' || !re.test(e.trim())) throw bad(`${name} contains an invalid email address`);
    return e.trim().toLowerCase();
  });
}

// Rejects any body field we did not expect (stops mass-assignment, e.g. sending "status":"resolved" where not allowed).
function onlyFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('request body must be a JSON object');
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`unexpected field(s): ${extra.join(', ')}`);
  return body;
}

module.exports = { positiveId, intInRange, oneOf, isoDate, dateRange, optionalText, emailList, onlyFields };
