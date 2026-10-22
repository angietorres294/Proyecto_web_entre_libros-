const { sesiones } = require('../controllers/auth.controller');

const TIEMPO_INACTIVIDAD = 10 * 60 * 1000;

const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({
            error: 'No autenticado'
        });
    }

    const sesion = sesiones.get(token);

    if (!sesion) {
        return res.status(401).json({
            error: 'Sesión inválida o expirada'
        });
    }

    const tiempoSinActividad = Date.now() - sesion.ultimoAcceso;

    if (tiempoSinActividad >= TIEMPO_INACTIVIDAD) {
        sesiones.delete(token);

        return res.status(401).json({
            error: 'Sesión expirada por inactividad'
        });
    }

    sesion.ultimoAcceso = Date.now();

    req.user = sesion;

    next();
};

const requireRole = (...rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'No autenticado'
            });
        }

        const rolUsuario = String(req.user.rol).toLowerCase();

        const rolesValidos = rolesPermitidos.map((rol) =>
            String(rol).toLowerCase()
        );

        if (!rolesValidos.includes(rolUsuario)) {
            return res.status(403).json({
                error: 'No tienes permisos para realizar esta acción'
            });
        }

        next();
    };
};

module.exports = {
    requireAuth,
    requireRole
};