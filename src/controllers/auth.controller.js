const crypto = require('crypto');
const nodemailer = require('nodemailer');
const supabase = require('../config/supabase');

const sesiones = new Map();
const codigos2FA = new Map(); // Almacenamiento temporal para códigos 2FA de Administradores

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
    const userCorreo = (correo || email || '').trim();
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
        .eq('correo', userCorreo)
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

async function enviarCodigo2FA(destino, codigo) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`\n==========================================`);
        console.log(`[CÓDIGO 2FA ADMIN] ${destino} -> ${codigo}`);
        console.log(`==========================================\n`);
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Entre Libros - Seguridad" <${process.env.SMTP_USER}>`,
        to: destino,
        subject: 'Código de Verificación de Seguridad (2FA)',
        text: `Tu código de verificación de Administrador es: ${codigo}. Vence en 10 minutos.`
    });
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
        const sesionActiva = sesiones.get(token);

        const rolSesion = sesionActiva?.rol ? String(sesionActiva.rol).toLowerCase() : '';
        const rolHeader = userRoleHeader ? String(userRoleHeader).toLowerCase() : '';

        const esAdmin = rolSesion === 'admin' || rolSesion === 'administrador' || 
                        rolHeader === 'admin' || rolHeader === 'administrador';

        if (!esAdmin) {
            return res.status(403).json({
                error: 'Acceso denegado: Únicamente un administrador autenticado puede crear nuevos administradores.'
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

const login = async (req, res) => {
    try {
        const correo = (req.body.correo || req.body.email || '').trim();
        const contraseña = req.body.contraseña || req.body.password;
        const codigo2FA = req.body.codigo2FA; // Código opcional enviado en segundo paso

        if (!correo || !contraseña) {
            return res.status(400).json({
                error: 'Correo y contraseña son obligatorios'
            });
        }

        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('correo', correo)
            .maybeSingle();

        if (error || !usuario) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const contraseñaValida = verifyPassword(contraseña, usuario.contraseña);
        if (!contraseñaValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        if (!usuario.contraseña.includes(':')) {
            await supabase
                .from('usuarios')
                .update({ contraseña: hashPassword(contraseña) })
                .eq('id', usuario.id);
        }

        const esAdmin = String(usuario.rol).toLowerCase() === 'admin' || String(usuario.rol).toLowerCase() === 'administrador';

        if (esAdmin) {
            if (!codigo2FA) {

                const codigo = String(crypto.randomInt(100000, 999999));
                codigos2FA.set(usuario.correo, {
                    codigo,
                    expira: Date.now() + 10 * 60 * 1000
                });

                await enviarCorreoCodigo(usuario.correo, codigo);

                return res.status(200).json({
                    requiere2FA: true,
                    mensaje: 'Código de verificación de doble factor enviado.'
                });
            }

            const datos2FA = codigos2FA.get(usuario.correo);
            if (!datos2FA || Date.now() > datos2FA.expira || datos2FA.codigo !== String(codigo2FA).trim()) {
                return res.status(401).json({ error: 'Código 2FA incorrecto o expirado.' });
            }

            codigos2FA.delete(usuario.correo);
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
        console.error(error);
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

const codigosRecuperacion = new Map();

async function enviarCorreoCodigo(destino, codigo) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`[DESARROLLO] Código para ${destino}: ${codigo}`);
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: `"Entre Libros" <${process.env.SMTP_USER}>`,
        to: destino,
        subject: 'Código de verificación',
        text: `Tu código de verificación es ${codigo}. Vence en 15 minutos.`
    });
}

const forgotPassword = async (req, res) => {
    try {
        const correo = (req.body.correo || req.body.email || '').trim();

        if (!correo) {
            return res.status(400).json({ error: 'El correo es obligatorio' });
        }

        const previo = codigosRecuperacion.get(correo);
        if (previo && Date.now() - previo.ultimoEnvio < 60 * 1000) {
            return res.status(429).json({
                error: 'Espera un minuto antes de pedir otro código'
            });
        }

        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('id')
            .eq('correo', correo)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ error: 'Error al consultar el usuario' });
        }

        if (usuario) {
            const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

            codigosRecuperacion.set(correo, {
                codigo,
                expira: Date.now() + 15 * 60 * 1000,
                intentos: 0,
                ultimoEnvio: Date.now()
            });

            try {
                await enviarCorreoCodigo(correo, codigo);
            } catch (errorCorreo) {
                console.error(errorCorreo);
                return res.status(500).json({ error: 'No se pudo enviar el correo' });
            }
        }

        return res.status(200).json({
            mensaje: 'Si el correo está registrado, recibirás un código.'
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const resetPassword = async (req, res) => {
    try {
        const correo = (req.body.correo || req.body.email || '').trim();
        const { codigo, nueva_contraseña, password } = req.body;
        const nuevaClave = nueva_contraseña || password;

        if (!correo || !codigo || !nuevaClave) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        const errorClave = validarContraseña(nuevaClave, correo);
        if (errorClave) {
            return res.status(400).json({ error: errorClave });
        }

        const registro = codigosRecuperacion.get(correo);

        if (!registro || Date.now() > registro.expira) {
            codigosRecuperacion.delete(correo);
            return res.status(400).json({ error: 'Código inválido o vencido' });
        }

        if (registro.intentos >= 5) {
            codigosRecuperacion.delete(correo);
            return res.status(400).json({
                error: 'Demasiados intentos. Solicita un nuevo código'
            });
        }

        registro.intentos++;

        const recibido = Buffer.from(String(codigo));
        const esperado = Buffer.from(registro.codigo);

        if (
            recibido.length !== esperado.length ||
            !crypto.timingSafeEqual(recibido, esperado)
        ) {
            return res.status(400).json({ error: 'Código inválido o vencido' });
        }

        const { data: usuario } = await supabase
            .from('usuarios')
            .select('id')
            .eq('correo', correo)
            .maybeSingle();

        if (!usuario) {
            return res.status(400).json({ error: 'Código inválido o vencido' });
        }

        const { error } = await supabase
            .from('usuarios')
            .update({ contraseña: hashPassword(nuevaClave) })
            .eq('id', usuario.id);

        if (error) {
            console.error(error);
            return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
        }

        codigosRecuperacion.delete(correo);

        for (const [token, sesion] of sesiones) {
            if (sesion.correo === correo) {
                sesiones.delete(token);
            }
        }

        return res.status(200).json({ mensaje: 'Contraseña actualizada correctamente' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

module.exports = {
    register,
    crearAdmin,
    login,
    logout,
    forgotPassword,
    resetPassword,
    sesiones
};