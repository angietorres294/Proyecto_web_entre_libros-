const $ = id => document.getElementById(id);
const editId = new URLSearchParams(location.search).get('id');
const token = sessionStorage.getItem('authToken');
let libroActual = null;
let activo = true;

function msg(texto, ok) {
  $('msg').textContent = texto;
  $('msg').style.color = ok ? 'var(--teal)' : 'var(--coral)';
}

function paso(n) {
  $('cantidad').value = Math.max(1, (parseInt($('cantidad').value) || 1) + n);
}

const inputTitulo = $('titulo');
if (inputTitulo) {
  inputTitulo.addEventListener('input', () => {
    $('cuenta').textContent = inputTitulo.value.length + ' / 80';
  });
}

function pintarToggle() {
  $('toggle').classList.toggle('off', !activo);
  $('estadoTxt').textContent = activo ? 'Estado: Activo en catálogo' : 'Estado: Inactivo';
}

function alternar() {
  if (editId) return;
  activo = !activo;
  pintarToggle();
}

function bloquearParaModificacion() {
  $('titulo').readOnly = true;
  $('titulo').disabled = true;

  $('autorEditorial').readOnly = true;
  $('autorEditorial').disabled = true;

  $('isbn').readOnly = true;
  $('isbn').disabled = true;
  $('btnScan').disabled = true;

  $('anio').readOnly = true;
  $('anio').disabled = true;

  $('categoria').disabled = true;
  $('sinopsis').readOnly = true;
  $('sinopsis').disabled = true;

  $('toggle').disabled = true;
  $('contenedorToggle').style.opacity = '0.5';
  $('contenedorToggle').style.pointerEvents = 'none';

  $('cantidad').disabled = false;
  $('cantidad').readOnly = false;
  $('btnMenos').disabled = false;
  $('btnMas').disabled = false;
}

async function cargarLibro() {
  if (!editId) return;

  $('tabNuevo').classList.remove('on');
  $('tabNuevo').classList.add('off');
  $('tabMod').classList.remove('off');
  $('tabMod').classList.add('on');
  $('tabMod').href = '/libro.html?id=' + editId;
  $('tabMod').textContent = '✎ Modificar (#LIB-' + editId + ')';
  $('btnGuardar').textContent = 'Guardar Unidades';
  $('subtituloPagina').textContent = 'Solo está permitida la modificación del número de ejemplares disponibles.';

  try {
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch('/api/books', { headers });
    const data = await res.json();
    
    const libros = Array.isArray(data) ? data : (data.libros || []);
    libroActual = libros.find(l => String(l.id) === String(editId));

    if (!libroActual) {
      return msg('No se encontró la información del libro solicitado.');
    }

    $('tituloPagina').textContent = 'Modificar Ejemplares: ' + libroActual.titulo;
    $('titulo').value = libroActual.titulo || '';
    $('cuenta').textContent = ($('titulo').value.length) + ' / 80';
    
    const autorTxt = libroActual.autor || '';
    const editorialTxt = libroActual.editorial || '';
    $('autorEditorial').value = [autorTxt, editorialTxt].filter(Boolean).join(' / ');
    
    $('isbn').value = libroActual.isbn || '';
    $('anio').value = libroActual['año_publicacion'] || '';
    $('cantidad').value = libroActual.cantidad_total || 1;

    if (libroActual.categoria) {
      const existe = [...$('categoria').options].some(o => o.value === libroActual.categoria || o.text === libroActual.categoria);
      if (!existe) $('categoria').add(new Option(libroActual.categoria, libroActual.categoria));
      $('categoria').value = libroActual.categoria;
    }

    if (libroActual.sinopsis) {
      $('sinopsis').value = libroActual.sinopsis;
    }

    activo = !!libroActual.activo;
    pintarToggle();
    bloquearParaModificacion();

  } catch (e) {
    console.error(e);
    msg('Error al conectar con el servidor para cargar el libro.');
  }
}

$('formLibro').addEventListener('submit', async (e) => {
  e.preventDefault();

  const cantidad = parseInt($('cantidad').value);
  if (!cantidad || cantidad < 1) return msg('Los ejemplares deben ser al menos 1.');

  let datos = {};
  if (editId) {
    datos = { cantidad_total: cantidad };
  } else {
    const titulo = $('titulo').value.trim();
    const partes = $('autorEditorial').value.split('/');
    const autor = (partes.shift() || '').trim();
    const editorial = partes.join('/').trim();
    const isbn = $('isbn').value.trim();
    const anio = parseInt($('anio').value);
    const categoria = $('categoria').value;

    if (!titulo || !autor || !editorial || !isbn || !anio || !categoria) {
      return msg('Completa todos los campos obligatorios.');
    }

    datos = { titulo, autor, categoria, editorial, año_publicacion: anio, isbn, cantidad_total: cantidad };
  }

  $('btnGuardar').disabled = true;
  msg('Guardando cambios...', true);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(editId ? ('/api/books/' + editId) : '/api/books', {
      method: editId ? 'PUT' : 'POST',
      headers,
      body: JSON.stringify(datos)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      $('btnGuardar').disabled = false;
      return msg(data.error || 'No se pudo guardar la modificación.');
    }

    location.href = '/books.html?guardado=' + encodeURIComponent(libroActual ? libroActual.titulo : $('titulo').value);
  } catch (err) {
    console.error(err);
    $('btnGuardar').disabled = false;
    msg('No se pudo conectar con el servidor.');
  }
});

cargarLibro();