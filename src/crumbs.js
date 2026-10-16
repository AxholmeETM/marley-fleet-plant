// Breadcrumbs that follow the way you came. A link from one section to a page in another carries ?from=<the page it was on>
// (added by the script in footer.ejs), and the breadcrumb then leads back through that page instead of the page's usual parents.
const { get } = require('./db');
const { SECTIONS, PLANT_SECTION } = require('./categories');
const sectionOf = (category) => SECTIONS[PLANT_SECTION.includes(category) ? 'plant' : 'equipment'];

// Only plain paths on this site, with an optional simple query string.
const SAFE = /^\/[\w\-/%.]*(\?[\w=&%.+-]*)?$/;

// The trail for the page someone came from, as [label, href] pairs, plus the menu item to keep highlighted.
async function originTrail(from) {
  if (typeof from !== 'string' || !SAFE.test(from) || from.startsWith('//')) return null;
  const [path] = from.split('?');
  let m;
  if (path === '/') return { trail: [['Dashboard', from]], nav: '/' };
  if (path === '/calendar') return { trail: [['Dashboard', '/'], ['Calendar', from]], nav: '/' };
  if (path === '/users') return { trail: [['Employees', from]], nav: '/users' };
  if ((m = path.match(/^\/users\/(\d+)$/))) {
    const u = await get('SELECT id, name FROM users WHERE id = ?', Number(m[1]));
    return u && { trail: [['Employees', '/users'], [u.name, from]], nav: '/users' };
  }
  if (path === '/vehicles') return { trail: [['Fleet', from]], nav: '/vehicles' };
  if ((m = path.match(/^\/vehicles\/(\d+)$/))) {
    const v = await get('SELECT id, reg FROM vehicles WHERE id = ?', Number(m[1]));
    return v && { trail: [['Fleet', '/vehicles'], [v.reg, from]], nav: '/vehicles' };
  }
  if (path === '/plant' || path === '/equipment') return { trail: [[path === '/plant' ? 'Plant' : 'Equipment', from]], nav: path };
  if ((m = path.match(/^\/plant\/(\d+)$/))) {
    const p = await get('SELECT id, plant_no, category FROM plant WHERE id = ?', Number(m[1]));
    if (!p) return null;
    const s = sectionOf(p.category);
    return { trail: [[s.label, s.href], [p.plant_no, from]], nav: s.href };
  }
  if (path === '/checks') return { trail: [['Plant', '/plant'], ['Site Checks', from]], nav: '/plant' };
  if (path === '/defects') return { trail: [['Plant', '/plant'], ['Defects', from]], nav: '/plant' };
  if (path === '/projects') return { trail: [['Projects', from]], nav: '/projects' };
  if ((m = path.match(/^\/projects\/([^/]+)$/))) {
    const code = decodeURIComponent(m[1]);
    const p = await get('SELECT code FROM projects WHERE code = ?', code);
    return p && { trail: [['Projects', '/projects'], [p.code, from]], nav: '/projects' };
  }
  if (path === '/training' || path === '/training/matrix') return { trail: [['Training Matrix', from]], nav: '/training' };
  if ((m = path.match(/^\/training\/people\/(\d+)$/))) {
    const u = await get('SELECT id, name FROM users WHERE id = ?', Number(m[1]));
    return u && { trail: [['Training Matrix', '/training/matrix'], [`${u.name} – training`, from]], nav: '/training' };
  }
  if (path === '/fuel' || path === '/fuel/log') return { trail: [['Fuel Logs', from]], nav: '/fuel' };
  if (path === '/fuel-cards') return { trail: [['Fuel Cards', from]], nav: '/fuel-cards' };
  if (path === '/reports') return { trail: [['Reports', from]], nav: '/reports' };
  return null;
}

module.exports = { originTrail };
