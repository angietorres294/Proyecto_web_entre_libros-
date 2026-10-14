(function () {
  const token = sessionStorage.getItem('authToken');
  let usuario = {};
  try { usuario = JSON.parse(sessionStorage.getItem('usuario')) || {}; } catch (e) {}
  const esAdmin = String(usuario.rol || '').toLowerCase() === 'administrador';
  const acceso = document.body.dataset.acceso;   // "admin" o "lector"

  if (!token) { location.replace('/login.html'); return; }

  // Cada rol solo entra a sus páginas
  if ((acceso === 'admin' && !esAdmin) || (acceso === 'lector' && esAdmin)) {
    location.replace('/inicio.html');
    return;
  }

  const actual = location.pathname;

  if (esAdmin) {
    

    // Barra superior del administrador (si la página la tiene)
    const superior = document.querySelector('.navbar nav');
    if (superior) {
      superior.innerHTML =
        `<a href="/inicio.html">Inicio</a>
         <a href="/books.html">Libros</a>
         <a href="/reports.html" class="${actual === '/reports.html' ? 'active' : ''}">Reportes</a>
         <a href="#" id="salirAdmin">Cerrar sesión</a>`;
      document.getElementById('salirAdmin').addEventListener('click', async (e) => {
        e.preventDefault();
        try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }); } catch (err) {}
        sessionStorage.clear();
        location.href = '/index.html';
      });
    }
  }

  // Flecha para volver al inicio (administradores y clientes)
  const encabezado = document.querySelector('.topbar, .navbar');
  if (encabezado) {
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