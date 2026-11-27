// Values shared by all three services. Agree changes with the team.
const CATEGORIES = ['dairy', 'bakery', 'fresh', 'dry', 'canned', 'frozen', 'beverages', 'hygiene', 'other'];
const ROLES = ['staff', 'admin'];

const ALERT_LEVELS = ['warning', 'critical', 'expired'];
const LEVEL_RANK = { warning: 1, critical: 2, expired: 3 };
const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'];
const RESOLUTION_ACTIONS = ['distributed', 'discarded', 'transferred', 'other']; // actions a person can choose
const REPORT_TYPES = ['inventory', 'distributions', 'waste'];
const MAX_EXPORTS_PER_USER = 20;

module.exports = {
  CATEGORIES, ROLES, ALERT_LEVELS, LEVEL_RANK, ALERT_STATUSES,
  RESOLUTION_ACTIONS, REPORT_TYPES, MAX_EXPORTS_PER_USER,
};
