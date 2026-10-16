// Training Matrix (admin accounts only): who holds which training, and when it runs out.
const express = require('express');
const { all, get, run, transaction } = require('../db');
const { UserError, text, isAdmin } = require('../auth');
const { isValidDate, dueStatus, ukDate } = require('../status');
const { listDocs, DOC_KINDS } = require('../documents');
const { userLabel, CSCS_CARDS, cscsLabel, PLANT_CARDS, cardScheme, recordCard, heldCards } = require('../categories');

const router = express.Router();
// Only admin users: not managers, who otherwise see everything.
router.use('/training', (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).render('error', { title: 'Admins only', message: 'The Training Matrix is only for admin users.' })));

const GROUPS = ['General', 'NPORS', 'CPCS'];
const listCourses = () => all('SELECT * FROM training_courses WHERE active = 1 ORDER BY sort, id');
const listPeople = () => all("SELECT id, name, role, employee_type, job_title, training_note, training_funded, cscs_card FROM users WHERE active = 1 AND (employee_type IS NOT NULL OR on_matrix = 1) ORDER BY name");

// A cell: held with an expiry date (ok, due within 30 days, expired), a note only (e.g. "Booked 19/10/26"), or needed but not held.
function cellStatus(r) {
  if (!r) return null;
  if (r.expiry) {
    const s = dueStatus(r.expiry, 30);
    return { level: s.level, short: ukDate(r.expiry).replace(/\/(\d\d)(\d\d)$/, '/$2'), text: s.level === 'ok' ? `Expires ${ukDate(r.expiry)}` : s.level === 'soon' ? `${s.text} (${ukDate(r.expiry)})` : `Expired ${ukDate(r.expiry)}`, days: s.days };
  }
  if (r.required) return { level: 'needed', short: 'Needed', text: 'Needed, not held' };
  if (r.note) return { level: 'note', short: r.note.length > 12 ? r.note.slice(0, 11) + '…' : r.note, text: r.note };
  return null;
}

async function matrixData() {
  const [courses, people, records] = await Promise.all([listCourses(), listPeople(),
    all('SELECT r.* FROM training_records r JOIN users u ON u.id = r.user_id WHERE u.active = 1 AND (u.employee_type IS NOT NULL OR u.on_matrix = 1)')]);
  const byKey = new Map(records.map((r) => [`${r.user_id}:${r.course_id}`, { ...r, status: cellStatus(r) }]));
  // The different NPORS and CPCS cards each person holds, from the card colour on their training.
  const grpOf = new Map(courses.map((c) => [c.id, c.grp]));
  const held = new Map();
  for (const r of records) {
    const s = cardScheme(grpOf.get(r.course_id));
    if (!s || !recordCard(grpOf.get(r.course_id), r.card)) continue;
    const h = held.get(r.user_id) || { npors: [], cpcs: [] };
    h[s].push(r.card); held.set(r.user_id, h);
  }
  const cardsOf = (u, s) => heldCards(s, (held.get(u.id) || { npors: [], cpcs: [] })[s]);
  return { courses, people, records, cell: (u, c) => byKey.get(`${u.id}:${c.id}`), cardsOf };
}

// Dashboard: what runs out in the next 30 days, what has already expired, and what is needed.
router.get('/training', async (req, res) => {
  const { courses, people, records } = await matrixData();
  const course = new Map(courses.map((c) => [c.id, c]));
  const person = new Map(people.map((p) => [p.id, p]));
  const items = records.filter((r) => course.has(r.course_id) && person.has(r.user_id)).map((r) => ({ r, s: cellStatus(r), c: course.get(r.course_id), p: person.get(r.user_id) })).filter((x) => x.s);
  const byDate = (a, b) => String(a.r.expiry || '').localeCompare(String(b.r.expiry || ''));
  const soon = items.filter((x) => x.s.level === 'soon').sort(byDate);
  const expired = items.filter((x) => x.s.level === 'overdue').sort((a, b) => -byDate(a, b));
  const needed = items.filter((x) => x.s.level === 'needed').sort((a, b) => a.p.name.localeCompare(b.p.name));
  const show = ['soon', 'expired', 'needed', 'notes'].includes(req.query.show) ? req.query.show : 'soon';
  res.render('training', { title: 'Training Matrix', soon, expired, needed, people, notes: people.filter((p) => p.training_note || p.training_funded), show, PLANT_CARDS, back: req.originalUrl });
});

// The matrix itself: one row per person, one column per course.
router.get('/training/matrix', async (req, res) => {
  const data = await matrixData();
  // One group at a time (General first), or all of them.
  const grp = req.query.group === 'All' ? 'All' : GROUPS.includes(req.query.group) ? req.query.group : GROUPS[0];
  const q = String(req.query.q || '').trim().toLowerCase();
  const attention = req.query.show === 'attention';
  const showEmpty = req.query.empty === '1';
  let courses = data.courses.filter((c) => grp === 'All' || c.grp === grp);
  let { people } = data;
  if (q) people = people.filter((p) => [p.name, p.job_title].some((f) => f && f.toLowerCase().includes(q)));
  const level = (p, c) => { const r = data.cell(p, c); return r && r.status && r.status.level; };
  if (attention) people = people.filter((p) => courses.some((c) => ['soon', 'overdue'].includes(level(p, c))));
  // Courses nobody shown holds are hidden unless asked for.
  const used = courses.filter((c) => people.some((p) => data.cell(p, c)));
  const hidden = courses.length - used.length;
  if (!showEmpty) courses = used;
  // Each person's totals across every course, for the Status column.
  const summary = (p) => {
    const t = { overdue: 0, soon: 0, needed: 0, ok: 0 };
    for (const c of data.courses) { const l = level(p, c); if (l in t) t[l] += 1; }
    return t;
  };
  res.render('training-matrix', { title: 'Training Matrix', courses, people, cell: data.cell, cardsOf: data.cardsOf, summary, CSCS_CARDS, cscsLabel, PLANT_CARDS, recordCard, grp, q: req.query.q || '', attention, showEmpty, hidden, GROUPS, userLabel, back: req.originalUrl });
});

// Save one person's record for one course; an empty one is removed.
async function saveRecord(userId, courseId, { expiry, note, required, card }) {
  if (!expiry && !note && !required && !card) return run('DELETE FROM training_records WHERE user_id = ? AND course_id = ?', userId, courseId);
  return run(`INSERT INTO training_records (user_id, course_id, expiry, note, required, card) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, course_id) DO UPDATE SET expiry = EXCLUDED.expiry, note = EXCLUDED.note, required = EXCLUDED.required, card = EXCLUDED.card,
      updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`, userId, courseId, expiry, note, required, card);
}

// Update one course for one person, from the matrix pop-up.
router.post('/training/people/:id/courses/:cid', async (req, res) => {
  const p = await get('SELECT id, name FROM users WHERE id = ?', Number(req.params.id));
  const c = await get('SELECT id, name, grp FROM training_courses WHERE id = ?', Number(req.params.cid));
  if (!p || !c) throw new UserError('Not found.', 404);
  const expiry = text(req.body.expiry);
  if (expiry && !isValidDate(expiry)) throw new UserError('Please enter a valid date.');
  const note = text(req.body.note);
  const required = req.body.required ? 1 : 0;
  const card = recordCard(c.grp, req.body.card) ? req.body.card : null;
  await saveRecord(p.id, c.id, { expiry, note, required, card });
  req.flash('success', `${p.name}: ${c.name} updated.`);
  // Back to the page the pop-up was opened from (the dashboard or the matrix), never anywhere else.
  const back = String(req.body.back || '');
  res.redirect(/^\/training(\/matrix)?(\?[\w=&%.-]*)?$/.test(back) ? back : '/training');
});

// One person's training, to update their dates and notes.
router.get('/training/people/:id', async (req, res) => {
  const p = await get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!p) return res.status(404).render('error', { title: 'Not found', message: 'Employee not found.' });
  const courses = await listCourses();
  const recs = new Map((await all('SELECT * FROM training_records WHERE user_id = ?', p.id)).map((r) => [r.course_id, { ...r, status: cellStatus(r) }]));
  const personDocs = await listDocs('person', p.id);
  res.render('training-person', { personDocs, DOC_KINDS, person: p, back: `/training/people/${p.id}`, canAddPersonDocs: true, title: `${p.name} – training`, crumbs: [['Training Matrix', '/training/matrix'], [p.name]], crumbHere: 'Training', navActive: '/training', p, courses, recs, GROUPS, userLabel, CSCS_CARDS, cscsLabel, PLANT_CARDS, cardScheme, onboard: req.query.onboard === '1' });
});

router.post('/training/people/:id', async (req, res) => {
  const p = await get('SELECT id, name FROM users WHERE id = ?', Number(req.params.id));
  if (!p) throw new UserError('Employee not found.', 404);
  const courses = await listCourses();
  const rows = [];
  for (const c of courses) {
    const expiry = text(req.body[`expiry_${c.id}`]);
    if (expiry && !isValidDate(expiry)) throw new UserError(`${c.name}: please enter a valid date.`);
    const card = req.body[`card_${c.id}`];
    rows.push({ c, expiry, note: text(req.body[`note_${c.id}`]), required: req.body[`required_${c.id}`] ? 1 : 0, card: recordCard(c.grp, card) ? card : null });
  }
  await transaction(async () => {
    await run('UPDATE users SET on_matrix = 1, training_funded = ?, cscs_card = ? WHERE id = ?', ['Company', 'Personal'].includes(req.body.training_funded) ? req.body.training_funded : null,
      Object.hasOwn(CSCS_CARDS, req.body.cscs_card) ? req.body.cscs_card : null, p.id);
    for (const r of rows) await saveRecord(p.id, r.c.id, r);
  });
  if (req.body.onboard) {
    req.flash('success', `${p.name} is set up and on the Training Matrix.`);
    return res.redirect(`/users/${p.id}`);
  }
  req.flash('success', `${p.name}'s training updated.`);
  res.redirect(`/training/people/${p.id}`);
});

// Put an employee on the matrix.
router.post('/training/people', async (req, res) => {
  const p = await get('SELECT id FROM users WHERE id = ? AND active = 1', Number(req.body.user_id));
  if (!p) throw new UserError('Please choose an employee.');
  await run('UPDATE users SET on_matrix = 1 WHERE id = ?', p.id);
  res.redirect(`/training/people/${p.id}`);
});


// Add a course (column) to the matrix.
router.post('/training/courses', async (req, res) => {
  const name = text(req.body.name);
  if (!name) throw new UserError('Please enter the course name.');
  const grp = GROUPS.includes(req.body.grp) ? req.body.grp : 'General';
  const last = await get('SELECT COALESCE(MAX(sort), 0) AS n FROM training_courses WHERE grp = ?', grp);
  await run('INSERT INTO training_courses (grp, name, sort) VALUES (?, ?, ?)', grp, name, Number(last.n) + 1);
  req.flash('success', `${name} added to the Training Matrix.`);
  res.redirect('/training/matrix');
});

module.exports = router;
module.exports.cellStatus = cellStatus;
