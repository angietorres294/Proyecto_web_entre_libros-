require('dotenv').config();
const crypto = require('crypto');
const supabase = require('../src/config/supabase');

function validarFortalezaPassword(password) {
    if (!password || typeof password !== 'string') {
        return { valida: false, razon: 'Contraseña no válida o vacía' };
    }

    const contraseñasProhibidas = [
        '12345', '123456', '12345678', '123456789', 
        'password', 'admin', 'contraseña', 'qwerty'
    ];

    if (contraseñasProhibidas.includes(password.toLowerCase().trim())) {
        return { valida: false, razon: 'Es una contraseña demasiado débil/común' };
    }

    if (password.length < 8) {
        return { valida: false, razon: 'Tiene menos de 8 caracteres' };
    }

    const tieneNumero = /\d/.test(password);
    const tieneLetra = /[a-zA-Z]/.test(password);

    if (!tieneNumero || !tieneLetra) {
        return { valida: false, razon: 'Debe contener al menos una letra y un número' };
    }

    return { valida: true };
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(passwordIngresada, passwordAlmacenada) {
    try {
        const [salt, hashOriginal] = passwordAlmacenada.split(':');
        if (!salt || !hashOriginal) return false;

        const hashNuevo = crypto.scryptSync(passwordIngresada, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hashOriginal, 'hex'), Buffer.from(hashNuevo, 'hex'));
    } catch (err) {
        return false;
    }
}

(async () => {
    console.log('Iniciando proceso de hasheo de contraseñas...\n');

    const { data: usuarios, error } = await supabase
        .from('usuarios')
        .select('id, correo, contraseña');

    if (error) {
        console.error('Error al conectar con Supabase:', error.message);
        process.exit(1);
    }

    let cifradas = 0;
    let omitidasDebiles = 0;
    let yaCifradas = 0;

    for (const u of usuarios) {
        
        if (!u.contraseña) continue;

        if (u.contraseña.includes(':')) {
            yaCifradas++;
            continue;
        }

        const validacion = validarFortalezaPassword(u.contraseña);

        if (!validacion.valida) {
            console.warn(`⚠️ Omitido [${u.correo}]: Contraseña rechazada -> "${u.contraseña}" (${validacion.razon})`);
            omitidasDebiles++;
            continue;
        }

        try {
            const contraseñaHasheada = hashPassword(u.contraseña);

            const { error: updateError } = await supabase
                .from('usuarios')
                .update({ contraseña: contraseñaHasheada })
                .eq('id', u.id);

            if (updateError) {
                console.error(`❌ Error actualizando a ${u.correo}:`, updateError.message);
            } else {
                console.log(`✅ Cifrada con éxito: ${u.correo}`);
                cifradas++;
            }
        } catch (err) {
            console.error(`❌ Excepción al procesar a ${u.correo}:`, err.message);
        }
    }

    console.log('\n--- Resumen de Operación ---');
    console.log(`Contraseñas cifradas con éxito: ${cifradas}`);
    console.log(`Contraseñas omitidas por débiles/inseguras: ${omitidasDebiles}`);
    console.log(`Contraseñas que ya estaban cifradas: ${yaCifradas}`);
    console.log('----------------------------');
})();

module.exports = {
    validarFortalezaPassword,
    hashPassword,
    verifyPassword
};