const { sesiones } = require('../controllers/auth.controller');

const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-token'];
    
    if (!token || !sesiones.has(token)) {
        return res.status(401).json({ error: 'Sesión no válida o expirada.' });
    }

    req.user = sesiones.get(token);
    next();
};

const requireRole = (...rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'No autenticado.' });
        }

        const rolUsuario = String(req.user.rol || '').toLowerCase();
        const rolesNormalizados = rolesPermitidos.map(r => String(r).toLowerCase());

        // Si el endpoint pide 'administrador', dejamos pasar también al 'superadministrador'
        const esPermitido = rolesNormalizados.includes(rolUsuario) ||
            (rolesNormalizados.includes('administrador') && (rolUsuario === 'superadministrador' || rolUsuario === 'superadmin'));

        if (!esPermitido) {
            return res.status(403).json({ error: 'Acceso denegado: No tienes los permisos necesarios.' });
        }

        next();
    };
};

module.exports = {
    requireAuth,
    requireRole
};