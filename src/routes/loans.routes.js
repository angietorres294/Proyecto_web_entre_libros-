const express = require('express');
const router = express.Router();
const {
    solicitar,
    solicitudesPrestamoPendientes,
    aprobarPrestamo,
    rechazarPrestamo,
    misPrestamos,
    devolver,
    solicitudesPendientes,
    aprobarDevolucion,
    misMultas,
    pagarMultaCliente,
    desbloquearCliente,
    historialPagosMultas,
    reservarLibro,
    misReservas,
    cancelarReserva,
    obtenerResenasLibro,
    crearResenaLibro
} = require('../controllers/loans.controller');

const { requireAuth, requireRole } = require('../middlewares/auth.middleware');

// Rutas Cliente - Préstamos y Multas
router.post('/request', requireAuth, solicitar);
router.get('/mine', requireAuth, misPrestamos);
router.patch('/:id/return', requireAuth, devolver);
router.get('/my-fines', requireAuth, misMultas);
router.post('/fines/:id/pay', requireAuth, pagarMultaCliente);

// Rutas Cliente - Reservas (Lista de espera)
router.post('/reserve', requireAuth, reservarLibro);
router.get('/my-reservations', requireAuth, misReservas);
router.delete('/reservations/:id', requireAuth, cancelarReserva);

// Rutas Cliente - Reseñas y Estrellas
router.get('/reviews/:libroId', obtenerResenasLibro);
router.post('/reviews/:libroId', requireAuth, crearResenaLibro);

// Rutas Administrador - Aprobación de Préstamos
router.get('/pending-requests', requireAuth, requireRole('Admin', 'Administrador'), solicitudesPrestamoPendientes);
router.patch('/:id/approve-loan', requireAuth, requireRole('Admin', 'Administrador'), aprobarPrestamo);
router.patch('/:id/reject-loan', requireAuth, requireRole('Admin', 'Administrador'), rechazarPrestamo);

// Rutas Administrador - Devoluciones y Multas
router.get('/pending-returns', requireAuth, requireRole('Admin', 'Administrador'), solicitudesPendientes);
router.patch('/:id/approve-return', requireAuth, requireRole('Admin', 'Administrador'), aprobarDevolucion);
router.patch('/unlock-user/:usuarioId', requireAuth, requireRole('Admin', 'Administrador'), desbloquearCliente);
router.get('/fines-payments', requireAuth, requireRole('Admin', 'Administrador'), historialPagosMultas);

module.exports = router;