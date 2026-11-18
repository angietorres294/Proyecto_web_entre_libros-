const express = require('express');

const {
    register,
    crearAdmin,
    listarAdmins,
    eliminarAdmin,
    login,
    logout,
    forgotPassword,
    resetPassword
} = require('../controllers/auth.controller');

const {
    requireAuth,
    requireRole
} = require('../middlewares/auth.middleware');

const router = express.Router();

// Definición de rutas
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);

// Rutas protegidas por Auth y Rol
router.post('/crear-admin', requireAuth, requireRole('administrador'), crearAdmin);
router.get('/admins', requireAuth, requireRole('superadministrador'), listarAdmins);
router.delete('/admin/:id', requireAuth, requireRole('superadministrador'), eliminarAdmin);

// Recuperación de contraseña
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Obtener datos del usuario autenticado
router.get('/me', requireAuth, (req, res) => {
    return res.status(200).json({
        usuario: req.user
    });
});

module.exports = router;