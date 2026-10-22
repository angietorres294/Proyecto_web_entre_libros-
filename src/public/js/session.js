
const TIEMPO_INACTIVIDAD = 10 * 60* 1000;

let temporizadorInactividad = null;

async function cerrarSesionPorInactividad() {
    const token = sessionStorage.getItem('authToken');

    if (!token) {
        return;
    }

    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (error) {
        console.error('Error al cerrar la sesión:', error);
    }

    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('usuario');

    window.location.href = '/login.html?expirada=1';
}

function reiniciarTemporizador() {
    const token = sessionStorage.getItem('authToken');

    if (!token) {
        return;
    }

    clearTimeout(temporizadorInactividad);

    temporizadorInactividad = setTimeout(
        cerrarSesionPorInactividad,
        TIEMPO_INACTIVIDAD
    );
}

const eventosActividad = [
    'click',
    'keydown',
    'mousemove',
    'scroll',
    'touchstart'
];

eventosActividad.forEach((evento) => {
    document.addEventListener(
        evento,
        reiniciarTemporizador
    );
});

if (sessionStorage.getItem('authToken')) {
    reiniciarTemporizador();
}