const express = require('express');
const { all, get, run, isUniqueViolation } = require('../db');
const { requireAdmin, UserError, text } = require('../auth');
const { listPlant } = require('../queries');
const { CATEGORY } = require('../categories');

const router = express.Router();
router.use('/projects', requireAdmin);

router.get('/projects', async (req, res) => {
  const projects = await all(`SELECT pr.*, u.name AS manager_name, (SELECT COUNT(*) FROM plant p WHERE p.job_ref = pr.code AND p.active = 1) AS items
    FROM projects pr LEFT JOIN users u ON u.id = pr.manager_id ORDER BY pr.active DESC, pr.code`);
  res.render('projects', { title: 'Projects', projects });
});

// Site managers who can be put in charge of a project (plus the current one, even if they have since left).
const listManagers = (keepId) => all("SELECT id, name, active FROM users WHERE (role = 'driver' AND employee_type = 'site_manager' AND active = 1) OR id = ? ORDER BY name", keepId);

async function findProject(code) {
  const project = await get('SELECT * FROM projects WHERE code = ?', code);
  if (!project) throw new UserError('Project not found.', 404);
  return project;
}

// One project: its details, site manager, and the plant and equipment booked to it.
router.get('/projects/:code', async (req, res) => {
  const project = await findProject(req.params.code);
  const plant = await listPlant();
  res.render('project-view', {
    title: `${project.code} – ${project.name}`,
    crumbs: [['Projects', '/projects'], [project.code]],
    navActive: '/projects',
    project, managers: await listManagers(project.manager_id),
    onProject: plant.filter((p) => p.job_ref === project.code),
    others: plant.filter((p) => p.job_ref !== project.code),
    CATEGORY,
  });
});

async function readProject(body) {
  const name = text(body.name);
  if (!name) throw new UserError('Please enter the project name or site.');
  const managerId = Number(body.manager_id) || null;
  if (managerId && !await get("SELECT id FROM users WHERE id = ? AND role = 'driver' AND employee_type = 'site_manager'", managerId)) {
    throw new UserError('Please choose a site manager from the list.');
  }
  return { name, active: body.active === '0' ? 0 : 1, manager_id: managerId };
}

router.post('/projects', async (req, res) => {
  const code = (text(req.body.code) || '').toUpperCase();
  if (!code) throw new UserError('Please enter the project number, e.g. M26-011.');
  const p = await readProject(req.body);
  try {
    await run('INSERT INTO projects (code, name, active, manager_id) VALUES (?, ?, ?, ?)', code, p.name, p.active, p.manager_id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`${code} is already on the list.`);
    throw err;
  }
  req.flash('success', `${code} added. You can now pick its site manager and plant.`);
  res.redirect(`/projects/${encodeURIComponent(code)}`);
});

router.post('/projects/:code', async (req, res) => {
  const project = await findProject(req.params.code);
  const p = await readProject(req.body);
  await run('UPDATE projects SET name = ?, active = ?, manager_id = ? WHERE code = ?', p.name, p.active, p.manager_id, project.code);
  req.flash('success', `${project.code} updated.`);
  res.redirect(`/projects/${encodeURIComponent(project.code)}`);
});

// Booking plant to a project here sets its Project No. on the register, and the other way round.
router.post('/projects/:code/plant', async (req, res) => {
  const project = await findProject(req.params.code);
  const ids = [].concat(req.body.plant_id || []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (!ids.length) throw new UserError('Please choose the plant or equipment to add.');
  for (const id of ids) await run('UPDATE plant SET job_ref = ? WHERE id = ?', project.code, id);
  req.flash('success', `${ids.length} item${ids.length === 1 ? '' : 's'} added to ${project.code}.`);
  res.redirect(`/projects/${encodeURIComponent(project.code)}#plant`);
});

router.post('/projects/:code/plant/:id/remove', async (req, res) => {
  const project = await findProject(req.params.code);
  const item = await get('SELECT id, plant_no FROM plant WHERE id = ? AND job_ref = ?', Number(req.params.id), project.code);
  if (!item) throw new UserError('That item is not on this project.', 404);
  await run('UPDATE plant SET job_ref = NULL WHERE id = ?', item.id);
  req.flash('success', `${item.plant_no} taken off ${project.code}.`);
  res.redirect(`/projects/${encodeURIComponent(project.code)}#plant`);
});

module.exports = router;
