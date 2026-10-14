const crypto = require('crypto');
const nodemailer = require('nodemailer');
const supabase = require('../config/supabase');


const sesiones = new Map();


function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');

    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString('hex');

    return `${salt}:${hash}`;
}


function verifyPassword(password, storedPassword) {
    
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

// REGISTRO
const register = async (req, res) => {
    try {
        const {
            nombre,
            apellido,
            correo,
            contraseña
        } = req.body;

        if (!nombre || !apellido || !correo || !contraseña) {
            return res.status(400).json({
                error: 'Todos los campos son obligatorios'
            });
        }

        // Verificar que el correo no exista
        const { data: usuarioExistente, error: errorBusqueda } =
            await supabase
                .from('usuarios')
                .select('id')
                .eq('correo', correo)
                .maybeSingle();

        if (errorBusqueda) {
            return res.status(500).json({
                error: 'Error al consultar el usuario'
            });
        }

        if (usuarioExistente) {
            return res.status(409).json({
                error: 'El correo ya está registrado'
            });
        }


        const contraseñaHash = hashPassword(contraseña);

        const { data: nuevoUsuario, error } = await supabase
            .from('usuarios')
            .insert([
                {
                    nombre,
                    apellido,
                    correo,
                    contraseña: contraseñaHash,
                    rol: correo.trim().toLowerCase().endsWith('@administrador.com') ? 'Administrador' : 'Cliente'
                }                  
            ])
            .select('id, nombre, apellido, correo, rol')
            .single();

        if (error) {
            console.error(error);

            return res.status(500).json({
                error: 'No se pudo registrar el usuario'
            });
        }

        return res.status(201).json({
            mensaje: 'Usuario registrado correctamente',
            usuario: nuevoUsuario
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
};

const login = async (req, res) => {
    try {
        const { correo, contraseña } = req.body;

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

        if (error) {
            return res.status(500).json({
                error: 'Error al consultar el usuario'
            });
        }

        if (!usuario) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        const contraseñaValida = verifyPassword(
            contraseña,
            usuario.contraseña
        );

        if (!contraseñaValida) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        if (!usuario.contraseña.includes(':')) {
            const nuevaContraseña = hashPassword(contraseña);

            await supabase
                .from('usuarios')
                .update({ contraseña: nuevaContraseña })
                .eq('id', usuario.id);
        }

        // Crear identificador de sesión
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

        return res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
};

// LOGOUT
const logout = (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
        sesiones.delete(token);
    }

    return res.status(200).json({
        mensaje: 'Sesión cerrada correctamente'
    });
};

// =========================================
// RECUPERACIÓN DE CONTRASEÑA
// =========================================

// correo -> { codigo, expira, intentos, ultimoEnvio }
const codigosRecuperacion = new Map();

async function enviarCorreoCodigo(destino, codigo) {
    // Modo desarrollo: si no hay SMTP configurado, el código sale en la terminal
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`[DESARROLLO] Código de recuperación para ${destino}: ${codigo}`);
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
        subject: 'Código de recuperación de contraseña',
        text: `Tu código de verificación es ${codigo}. Vence en 15 minutos. Si no lo solicitaste, ignora este mensaje.`
    });
}

const forgotPassword = async (req, res) => {
    try {
        const correo = (req.body.correo || '').trim();

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
        const correo = (req.body.correo || '').trim();
        const { codigo, nueva_contraseña } = req.body;

        if (!correo || !codigo || !nueva_contraseña) {
            return res.status(400).json({ error: 'Todos los campos son obligatorios' });
        }

        if (
            nueva_contraseña.length < 8 ||
            !/[A-Z]/.test(nueva_contraseña) ||
            !/\d/.test(nueva_contraseña)
        ) {
            return res.status(400).json({
                error: 'La contraseña debe tener 8 caracteres, una mayúscula y un número'
            });
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
            .update({ contraseña: hashPassword(nueva_contraseña) })
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
    login,
    logout,
    forgotPassword,
    resetPassword,
    sesiones
};
