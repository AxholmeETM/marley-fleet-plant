const express = require('express');

const router = express.Router();

// The Admin page has gone; Projects is its own menu item and old links land there.
router.get('/admin', (req, res) => res.redirect('/projects'));

module.exports = router;
