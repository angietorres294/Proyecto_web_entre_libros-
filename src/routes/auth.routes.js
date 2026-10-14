const express = require('express');

const {
    register,
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

// Registro
router.post('/register', register);

// Inicio de sesión
router.post('/login', login);

// Cierre de sesión
router.post('/logout', logout);

// Recuperación de contraseña
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Consultar el usuario de la sesión actual
router.get('/me', requireAuth, (req, res) => {
    return res.status(200).json({
        usuario: req.user
    });
});

module.exports = router;