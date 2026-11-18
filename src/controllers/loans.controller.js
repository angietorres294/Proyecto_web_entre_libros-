const supabase = require('../config/supabase');

const TABLA = 'prestamos';
const MULTA_POR_DIA = 10000;

function fechaLocal(offsetDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDias);
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

function calcularDiasRetraso(fechaPrevistaStr, fechaRealStr = fechaLocal()) {
    if (!fechaPrevistaStr) return 0;
    const fPrev = new Date(String(fechaPrevistaStr).slice(0, 10) + 'T00:00:00');
    const fReal = new Date(String(fechaRealStr).slice(0, 10) + 'T00:00:00');
    const diffMs = fReal - fPrev;
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function calcularDiasRestantes(fechaPrevistaStr) {
    if (!fechaPrevistaStr) return 999;
    const fPrev = new Date(String(fechaPrevistaStr).slice(0, 10) + 'T00:00:00');
    const fHoy = new Date(fechaLocal() + 'T00:00:00');
    return Math.ceil((fPrev - fHoy) / (1000 * 60 * 60 * 24));
}

// 1. Cliente solicita un préstamo -> queda en estado 'PENDIENTE' y aparta la unidad inmediatamente
const solicitar = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const libroId = parseInt(req.body.libro_id);

        if (!usuarioId) {
            return res.status(401).json({ error: 'No se pudo identificar la sesión del usuario.' });
        }

        if (!libroId) {
            return res.status(400).json({ error: 'El libro es obligatorio.' });
        }

        const { data: sancionesActivas } = await supabase
            .from('sanciones')
            .select('*')
            .eq('usuario_id', usuarioId)
            .eq('activa', true);

        if (sancionesActivas && sancionesActivas.length > 0) {
            const totalMulta = sancionesActivas.reduce(
                (acc, s) => acc + (s.monto || (s.dias_sancion || 1) * MULTA_POR_DIA),
                0
            );
            return res.status(403).json({
                error: `Préstamo bloqueado: Tienes una multa pendiente de $${totalMulta.toLocaleString('es-CO')} por devolución retardada. Ve a "Pago de multas" para saldarla y desbloquear tu cuenta.`
            });
        }

        const { data: prestamosUsuario } = await supabase
            .from(TABLA)
            .select('*')
            .eq('usuario_id', usuarioId);

        const enCurso = (prestamosUsuario || []).filter(p => {
            const est = String(p.estado).toUpperCase();
            return est === 'PRESTADO' || est === 'SOLICITADO' || est === 'PENDIENTE';
        });

        const hoyStr = fechaLocal();
        const vencidoActivo = enCurso.find(p => {
            const est = String(p.estado).toUpperCase();
            if (est !== 'PRESTADO' && est !== 'SOLICITADO') return false;
            const limite = p.fecha_devolucion_prevista || p.fecha_limite;
            return limite && calcularDiasRetraso(limite, hoyStr) > 0;
        });

        if (vencidoActivo) {
            const diasMora = calcularDiasRetraso(vencidoActivo.fecha_devolucion_prevista || vencidoActivo.fecha_limite, hoyStr);
            const multaMora = diasMora * MULTA_POR_DIA;
            return res.status(403).json({
                error: `Préstamo bloqueado: Tienes un libro con entrega vencida (${diasMora} día(s) de retraso). Multa acumulada de $${multaMora.toLocaleString('es-CO')} por devolución retardada.`
            });
        }

        const { data: libro, error: errorLibro } = await supabase
            .from('libros')
            .select('*')
            .eq('id', libroId)
            .maybeSingle();

        if (errorLibro || !libro) {
            return res.status(404).json({ error: 'El libro no existe en el catálogo.' });
        }

        if (libro.activo === false || libro.activo === 'false') {
            return res.status(400).json({ error: 'Este libro está inactivo.' });
        }

        if ((libro.cantidad_disponible ?? 0) < 1) {
            return res.status(409).json({ error: 'El libro no cuenta con unidades disponibles. Puedes unirte a la lista de espera.' });
        }

        const { data: reservasLibro } = await supabase
            .from('reservas')
            .select('*')
            .eq('libro_id', libroId)
            .eq('estado', 'DISPONIBLE')
            .order('id', { ascending: true });

        if (reservasLibro && reservasLibro.length > 0 && reservasLibro[0].usuario_id !== usuarioId && (libro.cantidad_disponible ?? 0) <= reservasLibro.length) {
            return res.status(409).json({
                error: 'La unidad disponible está reservada con prioridad para un lector en lista de espera. Únete a la lista de espera.'
            });
        }

        if (enCurso.length >= 3) {
            return res.status(409).json({ error: 'Solo puedes tener un máximo de 3 préstamos o solicitudes simultáneas.' });
        }

        if (enCurso.some(p => p.libro_id === libroId)) {
            return res.status(409).json({ error: 'Ya tienes este libro actualmente prestado o con una solicitud en curso.' });
        }

        const fechaHoy = fechaLocal();
        const fechaLimite = fechaLocal(14);

        const { data: prestamo, error: errorInsert } = await supabase
            .from(TABLA)
            .insert([{
                usuario_id: usuarioId,
                libro_id: libroId,
                fecha_prestamo: fechaHoy,
                fecha_devolucion_prevista: fechaLimite,
                estado: 'PENDIENTE'
            }])
            .select()
            .single();

        if (errorInsert) {
            return res.status(500).json({ error: 'No se pudo registrar la solicitud de préstamo: ' + errorInsert.message });
        }

        // Descontar inmediatamente 1 unidad disponible para que no pueda ser solicitada por otro lector
        await supabase
            .from('libros')
            .update({ cantidad_disponible: Math.max(0, (libro.cantidad_disponible || 1) - 1) })
            .eq('id', libroId);

        // Si el usuario tenía reserva activa de este libro, marcarla como COMPLETADA
        await supabase
            .from('reservas')
            .update({ estado: 'COMPLETADA' })
            .eq('usuario_id', usuarioId)
            .eq('libro_id', libroId)
            .in('estado', ['EN_ESPERA', 'DISPONIBLE']);

        return res.status(201).json({
            mensaje: 'Solicitud de préstamo enviada. Espera la aprobación del administrador.',
            prestamo
        });

    } catch (err) {
        console.error('Error interno:', err);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

// 2. Consultar solicitudes de préstamo pendientes (Admin)
const solicitudesPrestamoPendientes = async (req, res) => {
    try {
        const { data: prestamos, error } = await supabase
            .from(TABLA)
            .select('*')
            .eq('estado', 'PENDIENTE')
            .order('id', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });
        if (!prestamos || !prestamos.length) return res.status(200).json([]);

        const libroIds = [...new Set(prestamos.map(p => p.libro_id))];
        const usuarioIds = [...new Set(prestamos.map(p => p.usuario_id))];

        const { data: libros } = await supabase.from('libros').select('id, titulo, autor, cantidad_disponible').in('id', libroIds);
        const { data: usuarios } = await supabase.from('usuarios').select('id, nombre, apellido, correo').in('id', usuarioIds);

        const mapaLibros = new Map((libros || []).map(l => [l.id, l]));
        const mapaUsuarios = new Map((usuarios || []).map(u => [u.id, u]));

        return res.status(200).json(prestamos.map(p => {
            const usr = mapaUsuarios.get(p.usuario_id);
            const lib = mapaLibros.get(p.libro_id);
            return {
                id: p.id,
                usuario_nombre: usr ? `${usr.nombre} ${usr.apellido || ''}`.trim() : 'Usuario ' + p.usuario_id,
                usuario_email: usr?.correo || '',
                libro_titulo: lib?.titulo || 'Libro #' + p.libro_id,
                libro_autor: lib?.autor || '',
                unidades_disponibles: lib?.cantidad_disponible ?? 0,
                fecha_prestamo: p.fecha_prestamo,
                fecha_limite: p.fecha_devolucion_prevista || p.fecha_limite
            };
        }));
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// 3. Admin ACEPTA préstamo (la unidad ya fue apartada al solicitarse)
const aprobarPrestamo = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { data: prestamo } = await supabase.from(TABLA).select('*').eq('id', id).maybeSingle();

        if (!prestamo) {
            return res.status(404).json({ error: 'Solicitud de préstamo no encontrada.' });
        }

        if (String(prestamo.estado).toUpperCase() !== 'PENDIENTE') {
            return res.status(400).json({ error: 'Esta solicitud ya fue procesada anteriormente.' });
        }

        const fechaHoy = fechaLocal();
        const fechaLimite = fechaLocal(14);

        const { error: errUpdate } = await supabase
            .from(TABLA)
            .update({
                estado: 'PRESTADO',
                fecha_prestamo: fechaHoy,
                fecha_devolucion_prevista: fechaLimite
            })
            .eq('id', id);

        if (errUpdate) {
            return res.status(500).json({ error: 'No se pudo aprobar el préstamo: ' + errUpdate.message });
        }

        return res.status(200).json({ mensaje: 'Préstamo aprobado exitosamente. El libro ha sido asignado al lector.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// 4. Admin RECHAZA préstamo -> pasa a 'RECHAZADO' y devuelve la unidad apartada al catálogo
const rechazarPrestamo = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { data: prestamo } = await supabase.from(TABLA).select('*').eq('id', id).maybeSingle();

        if (!prestamo) {
            return res.status(404).json({ error: 'Solicitud de préstamo no encontrada.' });
        }

        if (String(prestamo.estado).toUpperCase() !== 'PENDIENTE') {
            return res.status(400).json({ error: 'Esta solicitud ya fue procesada anteriormente.' });
        }

        const { error } = await supabase
            .from(TABLA)
            .update({ estado: 'RECHAZADO' })
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });

        // Restaurar la unidad física al inventario
        const { data: libro } = await supabase
            .from('libros')
            .select('cantidad_disponible, cantidad_total')
            .eq('id', prestamo.libro_id)
            .maybeSingle();

        if (libro) {
            await supabase
                .from('libros')
                .update({
                    cantidad_disponible: Math.min((libro.cantidad_disponible || 0) + 1, libro.cantidad_total || 10)
                })
                .eq('id', prestamo.libro_id);
        }

        return res.status(200).json({ mensaje: 'Solicitud de préstamo rechazada y unidad restaurada al catálogo.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// 5. Mis préstamos (Cliente)
const misPrestamos = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const { data: prestamos, error } = await supabase
            .from(TABLA)
            .select('*')
            .eq('usuario_id', usuarioId)
            .order('id', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        const { data: sanciones } = await supabase
            .from('sanciones')
            .select('*')
            .eq('usuario_id', usuarioId)
            .eq('activa', true);

        const mapaSanciones = new Map((sanciones || []).map(s => [s.prestamo_id, s]));

        if (!prestamos || !prestamos.length) {
            return res.status(200).json([]);
        }

        const ids = [...new Set(prestamos.map(p => p.libro_id))];
        const { data: libros } = await supabase.from('libros').select('id, titulo, autor').in('id', ids);
        const mapaLibros = new Map((libros || []).map(l => [l.id, l]));

        const resultado = prestamos.map(p => {
            const l = mapaLibros.get(p.libro_id);
            const est = String(p.estado).toUpperCase();
            let estadoNorm = 'devuelto';
            if (est === 'PENDIENTE') estadoNorm = 'pendiente';
            else if (est === 'RECHAZADO') estadoNorm = 'rechazado';
            else if (est === 'PRESTADO' || est === 'ACTIVO') estadoNorm = 'activo';
            else if (est === 'SOLICITADO') estadoNorm = 'solicitado';

            const fechaLim = p.fecha_devolucion_prevista || p.fecha_limite;
            const sancion = mapaSanciones.get(p.id);
            const diasRetraso = sancion
                ? sancion.dias_sancion
                : calcularDiasRetraso(fechaLim, p.fecha_devolucion_real || fechaLocal());
            const diasRestantes = calcularDiasRestantes(fechaLim);

            return {
                id: p.id,
                libro_id: p.libro_id,
                titulo: l ? l.titulo : 'Libro #' + p.libro_id,
                autor: l ? l.autor : '',
                fecha_prestamo: p.fecha_prestamo,
                fecha_limite: fechaLim,
                fecha_devolucion: p.fecha_devolucion_real || p.fecha_devolucion,
                estado: estadoNorm,
                vencido: estadoNorm === 'activo' && diasRetraso > 0,
                dias_restantes: diasRestantes,
                bloqueado: Boolean(sancion),
                dias_retraso: diasRetraso,
                multa: sancion ? (sancion.monto || sancion.dias_sancion * MULTA_POR_DIA) : 0,
                motivo_multa: sancion ? sancion.motivo : null
            };
        });

        return res.status(200).json(resultado);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const devolver = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { data: prestamo } = await supabase.from(TABLA).select('*').eq('id', id).maybeSingle();

        if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' });

        await supabase.from(TABLA).update({ estado: 'SOLICITADO' }).eq('id', id);

        return res.status(200).json({ mensaje: 'Solicitud de devolución enviada correctamente.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const solicitudesPendientes = async (req, res) => {
    try {
        const { data: prestamos, error } = await supabase.from(TABLA).select('*').eq('estado', 'SOLICITADO');

        if (error) return res.status(500).json({ error: error.message });
        if (!prestamos || !prestamos.length) return res.status(200).json([]);

        const libroIds = [...new Set(prestamos.map(p => p.libro_id))];
        const usuarioIds = [...new Set(prestamos.map(p => p.usuario_id))];

        const { data: libros } = await supabase.from('libros').select('id, titulo, autor').in('id', libroIds);
        const { data: usuarios } = await supabase.from('usuarios').select('id, nombre, apellido, correo').in('id', usuarioIds);

        const mapaLibros = new Map((libros || []).map(l => [l.id, l]));
        const mapaUsuarios = new Map((usuarios || []).map(u => [u.id, u]));
        const hoy = fechaLocal();

        return res.status(200).json(prestamos.map(p => {
            const usr = mapaUsuarios.get(p.usuario_id);
            const fechaLimite = p.fecha_devolucion_prevista || p.fecha_limite;
            const diasRetraso = calcularDiasRetraso(fechaLimite, hoy);
            return {
                id: p.id,
                usuario_nombre: usr ? `${usr.nombre} ${usr.apellido || ''}`.trim() : 'Usuario ' + p.usuario_id,
                usuario_email: usr?.correo || '',
                libro_titulo: mapaLibros.get(p.libro_id)?.titulo || 'Libro #' + p.libro_id,
                fecha_prestamo: p.fecha_prestamo,
                fecha_limite: fechaLimite,
                dias_retraso: diasRetraso,
                multa_estimada: diasRetraso * MULTA_POR_DIA
            };
        }));
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const aprobarDevolucion = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { data: prestamo } = await supabase.from(TABLA).select('*').eq('id', id).maybeSingle();

        if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' });

        const fechaDevolucionReal = req.body?.fecha_devolucion_real || fechaLocal();
        const fechaPrevista = prestamo.fecha_devolucion_prevista || prestamo.fecha_limite;

        await supabase
            .from(TABLA)
            .update({
                estado: 'DEVUELTO',
                fecha_devolucion_real: fechaDevolucionReal
            })
            .eq('id', id);

        const { data: libro } = await supabase
            .from('libros')
            .select('cantidad_disponible, cantidad_total')
            .eq('id', prestamo.libro_id)
            .maybeSingle();

        if (libro) {
            await supabase.from('libros').update({
                cantidad_disponible: Math.min((libro.cantidad_disponible || 0) + 1, libro.cantidad_total || 1)
            }).eq('id', prestamo.libro_id);
        }

        const { data: siguienteReserva } = await supabase
            .from('reservas')
            .select('*')
            .eq('libro_id', prestamo.libro_id)
            .eq('estado', 'EN_ESPERA')
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (siguienteReserva) {
            await supabase
                .from('reservas')
                .update({ estado: 'DISPONIBLE' })
                .eq('id', siguienteReserva.id);
        }

        const diasRetraso = calcularDiasRetraso(fechaPrevista, fechaDevolucionReal);
        let multaGenerada = 0;

        if (diasRetraso > 0) {
            multaGenerada = diasRetraso * MULTA_POR_DIA;
            const motivo = `Multa de $${multaGenerada.toLocaleString('es-CO')} por devolución retardada (${diasRetraso} día(s) de retraso)`;

            await supabase.from('sanciones').insert([{
                usuario_id: prestamo.usuario_id,
                prestamo_id: prestamo.id,
                motivo,
                fecha_sancion: fechaDevolucionReal,
                dias_sancion: diasRetraso,
                monto: multaGenerada,
                activa: true
            }]);

            return res.status(200).json({
                mensaje: `Devolución registrada el ${fechaDevolucionReal} con ${diasRetraso} día(s) de retraso. Cliente bloqueado con multa de $${multaGenerada.toLocaleString('es-CO')}.`,
                fecha_devolucion_real: fechaDevolucionReal,
                con_multa: true,
                dias_retraso: diasRetraso,
                multa: multaGenerada
            });
        }

        return res.status(200).json({
            mensaje: `Devolución aceptada a tiempo el ${fechaDevolucionReal}. Sin multa.`,
            fecha_devolucion_real: fechaDevolucionReal,
            con_multa: false,
            dias_retraso: 0,
            multa: 0
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// 6. Multas pendientes, historial pagado Y cuentas habituales registradas por método de pago
const misMultas = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const { data: sanciones, error } = await supabase
            .from('sanciones')
            .select('*')
            .eq('usuario_id', usuarioId)
            .order('id', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        // Consultar cuentas habituales guardadas del usuario por método de pago
        const { data: cuentasGuardadas } = await supabase
            .from('cuentas_pago_usuario')
            .select('metodo_pago, numero_cuenta')
            .eq('usuario_id', usuarioId);

        const cuentasHabituales = {};
        (cuentasGuardadas || []).forEach(c => {
            cuentasHabituales[c.metodo_pago] = c.numero_cuenta;
        });

        if (!sanciones || !sanciones.length) {
            return res.status(200).json({ pendientes: [], pagadas: [], cuentas_habituales: cuentasHabituales });
        }

        const prestamoIds = [...new Set(sanciones.map(s => s.prestamo_id).filter(Boolean))];
        const { data: prestamos } = await supabase.from(TABLA).select('*').in('id', prestamoIds);
        const mapaPrestamos = new Map((prestamos || []).map(p => [p.id, p]));

        const libroIds = [...new Set((prestamos || []).map(p => p.libro_id))];
        const { data: libros } = await supabase.from('libros').select('id, titulo, autor').in('id', libroIds);
        const mapaLibros = new Map((libros || []).map(l => [l.id, l]));

        const { data: usr } = await supabase
            .from('usuarios')
            .select('nombre, apellido, correo')
            .eq('id', usuarioId)
            .maybeSingle();

        const nombreCliente = usr ? `${usr.nombre} ${usr.apellido || ''}`.trim() : 'Lector';

        const formateadas = sanciones.map(s => {
            const p = mapaPrestamos.get(s.prestamo_id);
            const l = p ? mapaLibros.get(p.libro_id) : null;
            const precio = s.monto || ((s.dias_sancion || 1) * MULTA_POR_DIA);

            return {
                id: s.id,
                prestamo_id: s.prestamo_id,
                cliente_nombre: nombreCliente,
                cliente_correo: usr?.correo || '',
                libro_titulo: l?.titulo || 'Libro #' + (p?.libro_id || ''),
                libro_autor: l?.autor || '',
                fecha_prestamo: p?.fecha_prestamo || '—',
                fecha_limite: p?.fecha_devolucion_prevista || p?.fecha_limite || '—',
                fecha_devolucion: p?.fecha_devolucion_real || s.fecha_sancion || '—',
                dias_retraso: s.dias_sancion || 1,
                precio,
                activa: Boolean(s.activa),
                metodo_pago: s.metodo_pago || '—',
                fecha_pago: s.fecha_pago || s.fecha_sancion || '—',
                motivo: s.motivo
            };
        });

        return res.status(200).json({
            pendientes: formateadas.filter(m => m.activa),
            pagadas: formateadas.filter(m => !m.activa),
            cuentas_habituales: cuentasHabituales
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// 7. Pago de multa con validación de cuenta habitual y notificación al administrador si cambia
const pagarMultaCliente = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const sancionId = parseInt(req.params.id);
        const { metodo_pago, numero_tarjeta, motivo_cambio_cuenta } = req.body;

        if (!metodo_pago) {
            return res.status(400).json({ error: 'Selecciona un método de pago.' });
        }

        const tarjetaLimpia = String(numero_tarjeta || '').replace(/\s+/g, '');
        if (!tarjetaLimpia || tarjetaLimpia.length < 10 || tarjetaLimpia.length > 19 || !/^\d+$/.test(tarjetaLimpia)) {
            return res.status(400).json({ error: 'Ingresa un número de cuenta o tarjeta válido (entre 10 y 19 dígitos).' });
        }

        const { data: sancion, error: errBusq } = await supabase
            .from('sanciones')
            .select('*')
            .eq('id', sancionId)
            .eq('usuario_id', usuarioId)
            .eq('activa', true)
            .maybeSingle();

        if (errBusq || !sancion) {
            return res.status(404).json({ error: 'La multa no existe o ya fue pagada.' });
        }

        // Verificar si ya tenía una cuenta habitual guardada para este método de pago
        const { data: cuentaHabitual } = await supabase
            .from('cuentas_pago_usuario')
            .select('*')
            .eq('usuario_id', usuarioId)
            .eq('metodo_pago', metodo_pago)
            .maybeSingle();

        let alertaAdmin = null;

        if (!cuentaHabitual) {
            // Primer pago con este método: guardar esta cuenta como habitual
            await supabase
                .from('cuentas_pago_usuario')
                .insert([{
                    usuario_id: usuarioId,
                    metodo_pago,
                    numero_cuenta: tarjetaLimpia
                }]);
        } else if (cuentaHabitual.numero_cuenta !== tarjetaLimpia) {
            // Está usando una cuenta DIFERENTE a la habitual: exigir justificación y notificar al Admin
            const motivoLimpio = String(motivo_cambio_cuenta || '').trim();
            if (!motivoLimpio || motivoLimpio.length < 5) {
                return res.status(400).json({
                    error: 'Estás usando una cuenta diferente a tu cuenta habitual para este método. Por favor escribe el motivo para notificar al administrador.'
                });
            }

            const ult4Anterior = cuentaHabitual.numero_cuenta.slice(-4);
            const ult4Nueva = tarjetaLimpia.slice(-4);
            alertaAdmin = `Cambio de cuenta en ${metodo_pago} (Habitual •••• ${ult4Anterior} → Nueva •••• ${ult4Nueva}). Motivo del cliente: "${motivoLimpio}"`;
        }

        const montoPagado = sancion.monto || ((sancion.dias_sancion || 1) * MULTA_POR_DIA);
        const ultimos4 = tarjetaLimpia.slice(-4);
        const detalleMetodo = `${metodo_pago} (•••• ${ultimos4})`;

        const { error: errUpdate } = await supabase
            .from('sanciones')
            .update({
                activa: false,
                monto: montoPagado,
                metodo_pago: detalleMetodo,
                fecha_pago: new Date().toISOString(),
                alerta_cambio_cuenta: alertaAdmin
            })
            .eq('id', sancionId);

        if (errUpdate) {
            return res.status(500).json({ error: 'No se pudo procesar el pago: ' + errUpdate.message });
        }

        return res.status(200).json({
            mensaje: alertaAdmin
                ? `¡Pago de $${montoPagado.toLocaleString('es-CO')} aprobado! Se envió la notificación del cambio de cuenta al administrador y tu cuenta ya está desbloqueada.`
                : `¡Pago de $${montoPagado.toLocaleString('es-CO')} aprobado vía ${detalleMetodo}! Tu cuenta ya está desbloqueada.`
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const desbloquearCliente = async (req, res) => {
    try {
        const usuarioId = parseInt(req.params.usuarioId);
        if (!usuarioId) {
            return res.status(400).json({ error: 'ID de cliente inválido.' });
        }

        const { error } = await supabase
            .from('sanciones')
            .update({
                activa: false,
                metodo_pago: 'Condonado / Desbloqueado por Admin',
                fecha_pago: new Date().toISOString()
            })
            .eq('usuario_id', usuarioId)
            .eq('activa', true);

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ mensaje: 'Cliente desbloqueado correctamente. Ya puede volver a pedir préstamos.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const historialPagosMultas = async (req, res) => {
    try {
        const { data: sanciones, error } = await supabase
            .from('sanciones')
            .select('*')
            .eq('activa', false)
            .order('id', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });
        if (!sanciones || !sanciones.length) return res.status(200).json([]);

        const usuarioIds = [...new Set(sanciones.map(s => s.usuario_id).filter(Boolean))];
        const prestamoIds = [...new Set(sanciones.map(s => s.prestamo_id).filter(Boolean))];

        const { data: usuarios } = await supabase.from('usuarios').select('id, nombre, apellido, correo').in('id', usuarioIds);
        const { data: prestamos } = await supabase.from(TABLA).select('id, libro_id, fecha_prestamo, fecha_devolucion_real').in('id', prestamoIds);

        const libroIds = [...new Set((prestamos || []).map(p => p.libro_id).filter(Boolean))];
        const { data: libros } = await supabase.from('libros').select('id, titulo').in('id', libroIds);

        const mapUsuarios = new Map((usuarios || []).map(u => [u.id, u]));
        const mapPrestamos = new Map((prestamos || []).map(p => [p.id, p]));
        const mapLibros = new Map((libros || []).map(l => [l.id, l]));

        const resultado = sanciones.map(s => {
            const usr = mapUsuarios.get(s.usuario_id);
            const pres = mapPrestamos.get(s.prestamo_id);
            const lib = pres ? mapLibros.get(pres.libro_id) : null;
            const monto = s.monto || ((s.dias_sancion || 1) * MULTA_POR_DIA);

            return {
                id: s.id,
                cliente_nombre: usr ? `${usr.nombre} ${usr.apellido || ''}`.trim() : 'Cliente #' + s.usuario_id,
                cliente_correo: usr?.correo || '—',
                libro_titulo: lib?.titulo || '—',
                dias_retraso: s.dias_sancion || 1,
                monto_pagado: monto,
                metodo_pago: s.metodo_pago || 'Pago registrado',
                fecha_pago: s.fecha_pago || s.fecha_sancion,
                alerta_cambio_cuenta: s.alerta_cambio_cuenta || null
            };
        });

        return res.status(200).json(resultado);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// ==========================================
// 7. SISTEMA DE RESERVAS (LISTA DE ESPERA)
// ==========================================
const reservarLibro = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const libroId = parseInt(req.body.libro_id);

        if (!usuarioId || !libroId) {
            return res.status(400).json({ error: 'Datos inválidos para realizar la reserva.' });
        }

        const { data: sanciones } = await supabase
            .from('sanciones')
            .select('id')
            .eq('usuario_id', usuarioId)
            .eq('activa', true);

        if (sanciones && sanciones.length > 0) {
            return res.status(403).json({ error: 'No puedes reservar libros mientras tengas multas pendientes por pagar.' });
        }

        const { data: existente } = await supabase
            .from('reservas')
            .select('*')
            .eq('usuario_id', usuarioId)
            .eq('libro_id', libroId)
            .in('estado', ['EN_ESPERA', 'DISPONIBLE'])
            .maybeSingle();

        if (existente) {
            return res.status(409).json({ error: 'Ya tienes una reserva activa para este libro.' });
        }

        const { error } = await supabase
            .from('reservas')
            .insert([{ usuario_id: usuarioId, libro_id: libroId, estado: 'EN_ESPERA' }]);

        if (error) return res.status(500).json({ error: 'Error al registrar la reserva: ' + error.message });

        return res.status(201).json({ mensaje: '🔖 ¡Reserva confirmada! Te avisaremos aquí cuando se libere una unidad.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const misReservas = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const { data: reservas, error } = await supabase
            .from('reservas')
            .select('*')
            .eq('usuario_id', usuarioId)
            .in('estado', ['EN_ESPERA', 'DISPONIBLE'])
            .order('id', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });
        if (!reservas || !reservas.length) return res.status(200).json([]);

        const libroIds = [...new Set(reservas.map(r => r.libro_id))];
        const { data: libros } = await supabase.from('libros').select('id, titulo, autor, cantidad_disponible').in('id', libroIds);
        const mapaLibros = new Map((libros || []).map(l => [l.id, l]));

        return res.status(200).json(reservas.map(r => {
            const lib = mapaLibros.get(r.libro_id);
            return {
                id: r.id,
                libro_id: r.libro_id,
                titulo: lib?.titulo || 'Libro #' + r.libro_id,
                autor: lib?.autor || '',
                unidades_disponibles: lib?.cantidad_disponible ?? 0,
                fecha_reserva: r.fecha_reserva,
                estado: r.estado
            };
        }));
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const cancelarReserva = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const reservaId = parseInt(req.params.id);

        await supabase
            .from('reservas')
            .update({ estado: 'CANCELADA' })
            .eq('id', reservaId)
            .eq('usuario_id', usuarioId);

        return res.status(200).json({ mensaje: 'Reserva cancelada correctamente.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// ==========================================
// 8. RESEÑAS Y CALIFICACIONES DE LIBROS
// ==========================================
const obtenerResenasLibro = async (req, res) => {
    try {
        const libroId = parseInt(req.params.libroId);
        const { data: resenas, error } = await supabase
            .from('resenas')
            .select('*')
            .eq('libro_id', libroId)
            .order('id', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });
        if (!resenas || !resenas.length) {
            return res.status(200).json({ promedio: 0, total: 0, resenas: [] });
        }

        const userIds = [...new Set(resenas.map(r => r.usuario_id))];
        const { data: usuarios } = await supabase.from('usuarios').select('id, nombre, apellido').in('id', userIds);
        const mapaUsers = new Map((usuarios || []).map(u => [u.id, u]));

        const suma = resenas.reduce((acc, r) => acc + (r.calificacion || 0), 0);
        const promedio = Number((suma / resenas.length).toFixed(1));

        return res.status(200).json({
            promedio,
            total: resenas.length,
            resenas: resenas.map(r => {
                const u = mapaUsers.get(r.usuario_id);
                return {
                    id: r.id,
                    lector: u ? `${u.nombre} ${u.apellido || ''}`.trim() : 'Lector',
                    calificacion: r.calificacion,
                    comentario: r.comentario || '',
                    fecha: r.fecha_resena
                };
            })
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const crearResenaLibro = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const libroId = parseInt(req.params.libroId);
        const calificacion = parseInt(req.body.calificacion);
        const comentario = String(req.body.comentario || '').trim();

        if (!calificacion || calificacion < 1 || calificacion > 5) {
            return res.status(400).json({ error: 'Selecciona una calificación entre 1 y 5 estrellas.' });
        }

        const { data: historial } = await supabase
            .from(TABLA)
            .select('id')
            .eq('usuario_id', usuarioId)
            .eq('libro_id', libroId)
            .in('estado', ['PRESTADO', 'SOLICITADO', 'DEVUELTO']);

        if (!historial || historial.length === 0) {
            return res.status(403).json({
                error: 'Solo puedes calificar libros que hayas tomado en préstamo en la biblioteca.'
            });
        }

        const { data: previa } = await supabase
            .from('resenas')
            .select('id')
            .eq('usuario_id', usuarioId)
            .eq('libro_id', libroId)
            .maybeSingle();

        if (previa) {
            await supabase
                .from('resenas')
                .update({ calificacion, comentario, fecha_resena: new Date().toISOString() })
                .eq('id', previa.id);
        } else {
            await supabase
                .from('resenas')
                .insert([{ usuario_id: usuarioId, libro_id: libroId, calificacion, comentario }]);
        }

        return res.status(201).json({ mensaje: '⭐ ¡Gracias por compartir tu calificación del libro!' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

module.exports = {
    solicitar,
    solicitudesPrestamoPendientes,
    aprobarPrestamo,
    rechazarPrestamo,
    misPrestamos,
    devolver,
    solicitudesPendientes,
    aprobarDevolucion,
    misMultas,
    pagarMultaCliente,
    desbloquearCliente,
    historialPagosMultas,
    reservarLibro,
    misReservas,
    cancelarReserva,
    obtenerResenasLibro,
    crearResenaLibro
};