const express = require('express');

const {
    register,
    crearAdmin,
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

router.post('/register', register);

router.post('/crear-admin', requireAuth, requireRole('administrador'), crearAdmin);

router.post('/login', login);

router.post('/logout', logout);

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

router.get('/me', requireAuth, (req, res) => {
    return res.status(200).json({
        usuario: req.user
    });
});

module.exports = router;