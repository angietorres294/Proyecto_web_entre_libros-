(function () {
  const rutaActual = location.pathname.toLowerCase();

  if (rutaActual.includes('login') || rutaActual.includes('register') || rutaActual.includes('recuperar') || rutaActual === '/' || rutaActual.includes('index')) {
    return;
  }

  const token = sessionStorage.getItem('authToken');
  let usuario = {};
  try { usuario = JSON.parse(sessionStorage.getItem('usuario')) || {}; } catch (e) {}

  const rol = String(usuario.rol || '').toLowerCase();
  const esAdmin = rol === 'admin' || rol === 'administrador';
  const acceso = document.body.dataset.acceso;  

  if (!token) { 
    location.replace('/login.html'); 
    return; 
  }

  if ((acceso === 'admin' && !esAdmin) || (acceso === 'lector' && esAdmin)) {
    location.replace('/inicio.html');
    return;
  }

  if (esAdmin) {

    const superior = document.querySelector('.navbar nav');
    if (superior) {
        superior.innerHTML =
        `<a href="/inicio.html">Inicio</a>
         <a href="/books.html">Libros</a>
         <a href="/reports.html" class="${rutaActual.includes('reports') ? 'active' : ''}">Reportes</a>
         <a href="/crear-admin.html" class="${rutaActual.includes('crear-admin') ? 'active' : ''}">Crear administrador</a>
         <a href="#" id="salirAdmin">Cerrar sesión</a>`;

      const btnSalir = document.getElementById('salirAdmin');
      if (btnSalir) {
        btnSalir.addEventListener('click', async (e) => {
          e.preventDefault();
          try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }); } catch (err) {}
          sessionStorage.clear();
          location.href = '/index.html';
        });
      }
    }
  }

  const encabezado = document.querySelector('.topbar, .navbar');
  if (encabezado && !document.querySelector('.volver-wrap')) {
    const estilo = document.createElement('style');
    estilo.textContent =
      '.volver-wrap{padding:.7rem 0}' +
      '.volver-wrap.ancho{max-width:1200px;margin:0 auto;padding:.9rem 1.5rem 0}' +
      '.volver-inicio{display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;font:700 .9rem "Outfit",Arial,sans-serif;color:#0F2540;background:#E4F1FF;border:1.5px solid #9ED0FF;border-radius:999px;padding:.5rem 1rem}' +
      '.volver-inicio:hover{background:#9ED0FF}' +
      '.volver-inicio b{font-size:1.15rem;line-height:1}';
    document.head.appendChild(estilo);

    const caja = document.createElement('div');
    caja.className = 'volver-wrap' + (encabezado.classList.contains('navbar') ? ' ancho' : '');
    caja.innerHTML = '<a href="/inicio.html" class="volver-inicio" aria-label="Volver al inicio"><b>←</b> Volver al inicio</a>';
    encabezado.insertAdjacentElement('afterend', caja);
  }
})();