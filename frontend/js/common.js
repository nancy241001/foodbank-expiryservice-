// Small helpers shared by all pages.
const CATEGORIES = ['dairy', 'bakery', 'fresh', 'dry', 'canned', 'frozen', 'beverages', 'hygiene', 'other'];
const DONOR_TYPES = ['individual', 'shop', 'organization'];

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysText = (d) => (d < 0 ? `${-d} day(s) ago` : d === 0 ? 'today' : `${d}`);
// Expiry level used for row colours (same thresholds as the default alert settings: 7 / 2 days).
const levelForDays = (d) => (d < 0 ? 'expired' : d <= 2 ? 'critical' : d <= 7 ? 'warning' : '');
const levelPill = (level) => el('span', { class: `pill ${level}` }, level);
// Form -> query string, skipping empty fields and unticked checkboxes.
const qs = (form) => new URLSearchParams([...new FormData(form)].filter(([, v]) => v !== '')).toString();

function fillSelect(select, values, labelFn = (v) => v) {
  values.forEach((v) => select.append(el('option', { value: v }, labelFn(v))));
}
document.querySelectorAll('.category-select').forEach((s) => fillSelect(s, CATEGORIES));
