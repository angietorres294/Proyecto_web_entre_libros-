const express = require('express');
const router = express.Router();
const { solicitar, misPrestamos, devolver, solicitudesPendientes, aprobarDevolucion } = require('../controllers/loans.controller');


const { requireAuth, requireRole } = require('../middlewares/auth.middleware');

router.post('/request', requireAuth, solicitar);
router.get('/mine', requireAuth, misPrestamos);
router.patch('/:id/return', requireAuth, devolver);

router.get('/pending-returns', requireAuth, requireRole('Admin', 'Administrador'), solicitudesPendientes);
router.patch('/:id/approve-return', requireAuth, requireRole('Admin', 'Administrador'), aprobarDevolucion);

module.exports = router;