// =========================================
// Autenticación - Entre Libros
// =========================================

const API_AUTH = '/api/auth';

function mostrarMensaje(mensaje, tipo = '') {
    const elemento = document.getElementById('auth-message');
    if (!elemento) return;
    elemento.textContent = mensaje;
    elemento.className = `msg ${tipo}`;
}

const COMUNES = ['12345','123456','1234567','12345678','123456789','1234567890','password','password1','contraseña','contrasena','qwerty','qwerty123','abc123','111111','000000','admin','admin123','administrador','iloveyou','entrelibros'];

function validarClave(p, correo) {
    if (p.length < 8) return 'La contraseña debe tener mínimo 8 caracteres.';
    if (!/[A-Z]/.test(p)) return 'Debe incluir al menos una mayúscula.';
    if (!/[a-z]/.test(p)) return 'Debe incluir al menos una minúscula.';
    if (!/\d/.test(p)) return 'Debe incluir al menos un número.';
    if (COMUNES.includes(p.toLowerCase())) return 'Esa contraseña es demasiado común.';
    const local = correo.split('@')[0].toLowerCase();
    if (local.length >= 4 && p.toLowerCase().includes(local)) return 'La contraseña no debe contener tu correo.';
    return null;
}

// Función auxiliar para enviar credenciales e interactuar con el 2FA
async function enviarPeticionLogin(correo, contraseña, codigo2FA = null) {
    const bodyData = { correo, contraseña };
    if (codigo2FA) {
        bodyData.codigo2FA = codigo2FA;
    }

    const respuesta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyData)
    });

    const datos = await respuesta.json();

    if (!respuesta.ok) {
        mostrarMensaje(
            datos.error || 'No se pudo iniciar sesión.',
            'auth-error'
        );
        return;
    }

    // Si el backend indica que requiere verificación de 2FA
    if (datos.requiere2FA) {
        mostrarMensaje('Código de verificación requerido.', '');
        
        const codigoIngresado = prompt('Ingresa el código de 6 dígitos enviado a tu correo/consola para completar el ingreso:');
        
        if (!codigoIngresado) {
            mostrarMensaje('Cancelaste la autenticación de doble factor.', 'auth-error');
            return;
        }

        // Reintento de petición incluyendo el codigo2FA ingresado
        await enviarPeticionLogin(correo, contraseña, codigoIngresado.trim());
        return;
    }

    // Login exitoso
    sessionStorage.setItem('authToken', datos.token);
    sessionStorage.setItem('usuario', JSON.stringify(datos.usuario));

    mostrarMensaje('Inicio de sesión exitoso. Redirigiendo...', 'auth-success');

    setTimeout(() => {
        window.location.href = '/inicio.html';
    }, 600);
}

const loginForm = document.getElementById('login-form');

if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const correo = document.getElementById('correo').value.trim();
        const contraseña = document.getElementById('contraseña').value;

        mostrarMensaje('Iniciando sesión...', '');

        try {
            await enviarPeticionLogin(correo, contraseña);
        } catch (error) {
            console.error(error);
            mostrarMensaje('No se pudo conectar con el servidor.', 'auth-error');
        }
    });
}