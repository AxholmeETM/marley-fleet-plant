// Renders the pre-built templates from src/views.generated.js (see scripts/build-views.js).
const path = require('path').posix;
const templates = require('./views.generated');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' };
const escapeXML = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]));

function render(name, data) {
  const fn = templates[name];
  if (!fn) throw new Error(`Unknown view: ${name}`);
  const include = (file, extra) => render(path.join(path.dirname(name), file), extra ? { ...data, ...extra } : data);
  return fn(data, escapeXML, include);
}

module.exports = { render };
