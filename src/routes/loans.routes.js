const express = require('express');
const { requireAuth } = require('../middlewares/auth.middleware');
const { solicitar, misPrestamos, devolver } = require('../controllers/loans.controller');

const router = express.Router();

router.post('/', requireAuth, solicitar);
router.get('/mine', requireAuth, misPrestamos);
router.patch('/:id/return', requireAuth, devolver);

module.exports = router;