const crypto = require('crypto');
const nodemailer = require('nodemailer');
const supabase = require('../config/supabase');

const sesiones = new Map();
const codigos2FA = new Map();
const codigosRecuperacion = new Map();

const CONTRASEÑAS_COMUNES = [
    '12345', '123456', '1234567', '12345678', '123456789', '1234567890',
    'password', 'password1', 'contraseña', 'contrasena', 'qwerty', 'qwerty123',
    'abc123', '111111', '000000', 'admin', 'admin123', 'administrador',
    'iloveyou', 'entrelibros'
];

function validarContraseña(password, correo = '') {
    if (typeof password !== 'string' || password.length < 8) {
        return 'La contraseña debe tener mínimo 8 caracteres';
    }
    if (!/[A-Z]/.test(password)) {
        return 'La contraseña debe incluir al menos una mayúscula';
    }
    if (!/[a-z]/.test(password)) {
        return 'La contraseña debe incluir al menos una minúscula';
    }
    if (!/\d/.test(password)) {
        return 'La contraseña debe incluir al menos un número';
    }
    if (CONTRASEÑAS_COMUNES.includes(password.toLowerCase().trim())) {
        return 'Esa contraseña es demasiado común. Elige una más segura';
    }
    const parteLocal = String(correo).split('@')[0].toLowerCase();
    if (parteLocal.length >= 4 && password.toLowerCase().includes(parteLocal)) {
        return 'La contraseña no debe contener tu correo';
    }
    return null;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString('hex');

    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword) return false;

    if (!storedPassword.includes(':')) {
        return password === storedPassword;
    }

    const [salt, storedHash] = storedPassword.split(':');
    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString('hex');

    return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(storedHash, 'hex')
    );
}

async function crearUsuario({ nombre, apellido, correo, email, contraseña, password, rol }) {
    const userCorreo = (correo || email || '').trim().toLowerCase();
    const userPassword = contraseña || password;
    const userNombre = (nombre || '').trim();
    const userApellido = (apellido || '').trim();

    if (!userNombre || !userCorreo || !userPassword) {
        return { status: 400, error: 'Todos los campos obligatorios deben ser completados' };
    }

    const errorClave = validarContraseña(userPassword, userCorreo);
    if (errorClave) {
        return { status: 400, error: errorClave };
    }

    const { data: usuarioExistente, error: errorBusqueda } = await supabase
        .from('usuarios')
        .select('id')
        .ilike('correo', userCorreo)
        .maybeSingle();

    if (errorBusqueda) {
        return { status: 500, error: 'Error al consultar disponibilidad del usuario' };
    }

    if (usuarioExistente) {
        return { status: 409, error: 'El correo electrónico ya está registrado' };
    }

    const { data: nuevoUsuario, error } = await supabase
        .from('usuarios')
        .insert([
            {
                nombre: userNombre,
                apellido: userApellido,
                correo: userCorreo,
                contraseña: hashPassword(userPassword),
                rol: rol || 'Cliente'
            }
        ])
        .select('id, nombre, apellido, correo, rol')
        .single();

    if (error) {
        console.error('Error insertando usuario en Supabase:', error);
        return { status: 500, error: 'No se pudo registrar el usuario en la base de datos' };
    }

    return { status: 201, usuario: nuevoUsuario };
}

async function enviarCorreoOTP(destino, codigo, motivo = 'Recuperación de Contraseña') {
    console.log(`\n==================================================`);
    console.log(`🔑 [${motivo.toUpperCase()}]`);
    console.log(`   Destinatario : ${destino}`);
    console.log(`   CÓDIGO OTP   : ${codigo}`);
    console.log(`   Validez      : 15 minutos`);
    console.log(`==================================================\n`);
}

const register = async (req, res) => {
    try {
        const { nombre, apellido, correo, email, contraseña, password } = req.body;
        const correoFinal = (correo || email || '').trim().toLowerCase();

        if (correoFinal.includes('@administrador')) {
            return res.status(400).json({
                error: 'No se permite el uso del correo @administrador en el registro público.'
            });
        }

        const resultado = await crearUsuario({
            nombre,
            apellido,
            correo: correoFinal,
            contraseña: contraseña || password,
            rol: 'Cliente'
        });

        if (resultado.error) {
            return res.status(resultado.status).json({ error: resultado.error });
        }

        return res.status(201).json({
            mensaje: 'Usuario registrado correctamente',
            usuario: resultado.usuario
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const crearAdmin = async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-token'];
        const userRoleHeader = req.headers['user-role'];
        const sesionActiva = req.user || sesiones.get(token);

        const rolSesion = sesionActiva?.rol ? String(sesionActiva.rol).toLowerCase() : '';
        const rolHeader = userRoleHeader ? String(userRoleHeader).toLowerCase() : '';

        const esAdminOSuper = rolSesion === 'admin' || rolSesion === 'administrador' || 
                             rolSesion === 'superadministrador' || rolSesion === 'superadmin' ||
                             rolHeader === 'admin' || rolHeader === 'administrador' ||
                             rolHeader === 'superadministrador' || rolHeader === 'superadmin';

        if (!esAdminOSuper) {
            return res.status(403).json({
                error: 'Acceso denegado: Únicamente administradores pueden crear nuevos administradores.'
            });
        }

        const { nombre, apellido, correo, email, contraseña, password } = req.body;

        const resultado = await crearUsuario({
            nombre,
            apellido,
            correo: correo || email,
            contraseña: contraseña || password,
            rol: 'Administrador'
        });

        if (resultado.error) {
            return res.status(resultado.status).json({ error: resultado.error });
        }

        return res.status(201).json({
            mensaje: 'Administrador creado correctamente',
            usuario: resultado.usuario
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const listarAdmins = async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-token'];
        const sesionActiva = req.user || sesiones.get(token);

        const rolUsuario = sesionActiva?.rol ? String(sesionActiva.rol).toLowerCase() : '';
        const esSuperAdmin = rolUsuario === 'superadministrador' || rolUsuario === 'superadmin';

        if (!esSuperAdmin) {
            return res.status(403).json({
                error: 'Acceso denegado: Únicamente el Superadministrador puede consultar administradores.'
            });
        }

        const { data: admins, error } = await supabase
            .from('usuarios')
            .select('id, nombre, apellido, correo, rol')
            .in('rol', ['Administrador', 'administrador', 'admin', 'Admin'])
            .order('id', { ascending: true });

        if (error) {
            console.error('Error listando administradores:', error);
            return res.status(500).json({ error: 'No se pudo obtener la lista de administradores.' });
        }

        return res.status(200).json({ administradores: admins || [] });
    } catch (error) {
        console.error('Error en listarAdmins:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const eliminarAdmin = async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-token'];
        const sesionActiva = req.user || sesiones.get(token);

        const rolUsuario = sesionActiva?.rol ? String(sesionActiva.rol).toLowerCase() : '';
        const esSuperAdmin = rolUsuario === 'superadministrador' || rolUsuario === 'superadmin';

        if (!esSuperAdmin) {
            return res.status(403).json({
                error: 'Acceso denegado: Únicamente el Superadministrador tiene permisos para eliminar administradores.'
            });
        }

        const adminId = parseInt(req.params.id);
        if (!adminId) {
            return res.status(400).json({ error: 'El ID del administrador a eliminar es obligatorio.' });
        }

        const { data: usuarioAEliminar, error: errorBusqueda } = await supabase
            .from('usuarios')
            .select('*')
            .eq('id', adminId)
            .maybeSingle();

        if (errorBusqueda || !usuarioAEliminar) {
            return res.status(404).json({ error: 'El administrador no existe.' });
        }

        const rolObjetivo = String(usuarioAEliminar.rol).toLowerCase();
        if (rolObjetivo !== 'admin' && rolObjetivo !== 'administrador') {
            return res.status(400).json({ error: 'El usuario seleccionado no posee el rol de Administrador.' });
        }

        if (usuarioAEliminar.id === sesionActiva.id) {
            return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
        }

        const { error: errorEliminar } = await supabase
            .from('usuarios')
            .delete()
            .eq('id', adminId);

        if (errorEliminar) {
            console.error('Error eliminando administrador:', errorEliminar);
            return res.status(500).json({ error: 'No se pudo eliminar el administrador.' });
        }

        for (const [sToken, sDatos] of sesiones) {
            if (sDatos.id === adminId) {
                sesiones.delete(sToken);
            }
        }

        return res.status(200).json({
            mensaje: `El administrador ${usuarioAEliminar.nombre} ${usuarioAEliminar.apellido || ''} ha sido eliminado correctamente.`
        });

    } catch (error) {
        console.error('Error interno:', error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const login = async (req, res) => {
    try {
        const correo = (req.body.correo || req.body.email || '').trim().toLowerCase();
        const contraseña = req.body.contraseña || req.body.password;
        const codigo2FA = req.body.codigo2FA;

        if (!correo || !contraseña) {
            return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
        }

        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .ilike('correo', correo)
            .maybeSingle();

        if (error || !usuario) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const contraseñaValida = verifyPassword(contraseña, usuario.contraseña);
        if (!contraseñaValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const rolLower = String(usuario.rol || '').toLowerCase();
        const esAdminOSuper = rolLower === 'admin' || rolLower === 'administrador' || 
                             rolLower === 'superadministrador' || rolLower === 'superadmin';

        if (esAdminOSuper) {
            if (!codigo2FA) {
                const codigo = String(crypto.randomInt(100000, 999999));
                codigos2FA.set(usuario.correo.toLowerCase(), {
                    codigo,
                    expira: Date.now() + 10 * 60 * 1000
                });

                await enviarCorreoOTP(usuario.correo, codigo, 'Acceso Administrativo 2FA');

                return res.status(200).json({
                    requiere2FA: true,
                    mensaje: 'Código de verificación de doble factor generado en consola.'
                });
            }

            const datos2FA = codigos2FA.get(usuario.correo.toLowerCase());
            if (!datos2FA || Date.now() > datos2FA.expira || datos2FA.codigo !== String(codigo2FA).trim()) {
                return res.status(401).json({ error: 'Código 2FA incorrecto o expirado.' });
            }

            codigos2FA.delete(usuario.correo.toLowerCase());
        }

        const token = crypto.randomBytes(32).toString('hex');

        sesiones.set(token, {
            id: usuario.id,
            nombre: usuario.nombre,
            apellido: usuario.apellido,
            correo: usuario.correo,
            rol: usuario.rol,
            ultimoAcceso: Date.now()
        });

        return res.status(200).json({
            mensaje: 'Inicio de sesión exitoso',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                apellido: usuario.apellido,
                correo: usuario.correo,
                rol: usuario.rol
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const logout = (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
        sesiones.delete(token);
    }

    return res.status(200).json({
        mensaje: 'Sesión cerrada correctamente'
    });
};

const forgotPassword = async (req, res) => {
    try {
        const correo = (req.body.correo || req.body.email || '').trim().toLowerCase();

        if (!correo) {
            return res.status(400).json({ error: 'El correo es obligatorio' });
        }

        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('id, correo, nombre')
            .ilike('correo', correo)
            .maybeSingle();

        if (error || !usuario) {
            return res.status(404).json({ 
                error: 'No encontramos ninguna cuenta registrada con ese correo electrónico.' 
            });
        }

        const codigo = String(crypto.randomInt(100000, 999999));

        codigosRecuperacion.set(correo, {
            codigo,
            expira: Date.now() + 15 * 60 * 1000
        });

        await enviarCorreoOTP(usuario.correo, codigo, 'Recuperación de Contraseña');

        return res.status(200).json({
            mensaje: `Código generado para ${usuario.correo}. Revisa la consola del servidor.`,
            requiereOTP: true
        });

    } catch (error) {
        console.error('Error en forgotPassword:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const resetPassword = async (req, res) => {
    try {
        const correo = (req.body.correo || req.body.email || '').trim().toLowerCase();
        const codigoOTP = String(req.body.codigo || req.body.codigoOTP || req.body.otp || '').trim();
        const nuevaContraseña = req.body.contraseña || req.body.nuevaContraseña || req.body.password;

        if (!correo || !codigoOTP || !nuevaContraseña) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios (correo, código y nueva contraseña).' });
        }

        const errorClave = validarContraseña(nuevaContraseña, correo);
        if (errorClave) {
            return res.status(400).json({ error: errorClave });
        }

        const datosRecuperacion = codigosRecuperacion.get(correo);

        if (!datosRecuperacion || Date.now() > datosRecuperacion.expira || datosRecuperacion.codigo !== codigoOTP) {
            return res.status(401).json({ error: 'El código de verificación es incorrecto o ha expirado.' });
        }

        const { error: errorUpdate } = await supabase
            .from('usuarios')
            .update({ contraseña: hashPassword(nuevaContraseña) })
            .ilike('correo', correo);

        if (errorUpdate) {
            console.error('Error al actualizar contraseña:', errorUpdate);
            return res.status(500).json({ error: 'No se pudo restablecer la contraseña.' });
        }

        codigosRecuperacion.delete(correo);

        return res.status(200).json({ mensaje: 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.' });

    } catch (error) {
        console.error('Error en resetPassword:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

module.exports = {
    register,
    crearAdmin,
    listarAdmins,
    eliminarAdmin,
    login,
    logout,
    forgotPassword,
    resetPassword,
    sesiones
};