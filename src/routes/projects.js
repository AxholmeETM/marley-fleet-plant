const express = require('express');
const { all, get, run, isUniqueViolation } = require('../db');
const { requireAdmin, UserError, text } = require('../auth');

const router = express.Router();
router.use('/projects', requireAdmin);

router.get('/projects', async (req, res) => {
  const projects = await all(`SELECT pr.*, (SELECT COUNT(*) FROM plant p WHERE p.job_ref = pr.code AND p.active = 1) AS items
    FROM projects pr ORDER BY pr.active DESC, pr.code`);
  res.render('projects', { title: 'Projects', projects });
});

function readProject(body) {
  const name = text(body.name);
  if (!name) throw new UserError('Please enter the project name or site.');
  return { name, active: body.active === '0' ? 0 : 1 };
}

router.post('/projects', async (req, res) => {
  const code = (text(req.body.code) || '').toUpperCase();
  if (!code) throw new UserError('Please enter the project number, e.g. M26-011.');
  const p = readProject(req.body);
  try {
    await run('INSERT INTO projects (code, name, active) VALUES (?, ?, ?)', code, p.name, p.active);
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`${code} is already on the list.`);
    throw err;
  }
  req.flash('success', `${code} added.`);
  res.redirect('/projects');
});

router.post('/projects/:code', async (req, res) => {
  const code = req.params.code;
  if (!await get('SELECT code FROM projects WHERE code = ?', code)) throw new UserError('Project not found.', 404);
  const p = readProject(req.body);
  await run('UPDATE projects SET name = ?, active = ? WHERE code = ?', p.name, p.active, code);
  req.flash('success', `${code} updated.`);
  res.redirect('/projects');
});

module.exports = router;
