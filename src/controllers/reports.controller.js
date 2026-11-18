const supabase = require('../config/supabase');

const MULTA_POR_DIA = 10000;

function calcularDiasRetraso(fechaPrevistaStr, fechaComparacionStr) {
    if (!fechaPrevistaStr || !fechaComparacionStr) return 0;
    const fPrev = new Date(String(fechaPrevistaStr).slice(0, 10) + 'T00:00:00');
    const fComp = new Date(String(fechaComparacionStr).slice(0, 10) + 'T00:00:00');
    const diffMs = fComp - fPrev;
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

const getReportePrestamos = async (req, res) => {
    try {
        const { data: prestamos, error: errorPrestamos } = await supabase
            .from('prestamos')
            .select('*')
            .order('fecha_prestamo', { ascending: false });

        if (errorPrestamos) {
            return res.status(500).json({ error: 'Error al consultar el reporte de préstamos.' });
        }

        if (!prestamos || prestamos.length === 0) {
            return res.status(200).json([]);
        }

        const usuariosIds = [...new Set(prestamos.map(p => p.usuario_id))];
        const librosIds = [...new Set(prestamos.map(p => p.libro_id))];
        const prestamosIds = prestamos.map(p => p.id);

        const { data: usuarios } = await supabase
            .from('usuarios')
            .select('id, nombre, apellido, correo, rol')
            .in('id', usuariosIds);

        const { data: libros } = await supabase
            .from('libros')
            .select('id, titulo, autor')
            .in('id', librosIds);

        const { data: sanciones } = await supabase
            .from('sanciones')
            .select('*')
            .in('prestamo_id', prestamosIds);

        const mapUsuarios = new Map((usuarios || []).map(u => [u.id, u]));
        const mapLibros = new Map((libros || []).map(l => [l.id, l]));
        const mapSanciones = new Map((sanciones || []).map(s => [s.prestamo_id, s]));

        const hoyStr = new Date().toISOString().slice(0, 10);

        const reporte = prestamos.map(p => {
            const usr = mapUsuarios.get(p.usuario_id);
            const lib = mapLibros.get(p.libro_id);
            const sancion = mapSanciones.get(p.id);
            const estUpper = String(p.estado).toUpperCase();

            const fInicio = new Date(p.fecha_prestamo);
            const fLimiteStr = p.fecha_devolucion_prevista || p.fecha_limite;
            const fDevStr = p.fecha_devolucion_real || null;
            const fDev = fDevStr ? new Date(fDevStr) : null;

            const diffTime = Math.abs((fDev || new Date()) - fInicio);
            const diasDuracion = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

            const ignorarMora = estUpper === 'PENDIENTE' || estUpper === 'RECHAZADO';
            const diasRetraso = ignorarMora
                ? 0
                : (sancion ? (sancion.dias_sancion || 0) : calcularDiasRetraso(fLimiteStr, fDevStr || hoyStr));

            const multaMonto = ignorarMora ? 0 : (sancion?.monto || (diasRetraso * MULTA_POR_DIA));

            // Solo es pagada si existe una sanción registrada y su campo activa es false
            const esPagada = Boolean(sancion && sancion.activa === false);
            const esActiva = multaMonto > 0 && !esPagada;

            return {
                id: p.id,
                usuario_id: p.usuario_id,
                usuario_nombre: usr ? `${usr.nombre} ${usr.apellido || ''}`.trim() : 'Usuario Desconocido',
                usuario_correo: usr?.correo || 'Sin correo',
                usuario_rol: usr?.rol || 'Cliente',
                libro_titulo: lib?.titulo || 'Libro desconocido',
                libro_autor: lib?.autor || '—',
                fecha_prestamo: p.fecha_prestamo,
                fecha_limite: fLimiteStr,
                fecha_devolucion: fDevStr,
                dias_transcurridos: diasDuracion,
                dias_retraso: diasRetraso,
                multa: multaMonto,
                multa_activa: esActiva,
                multa_pagada: esPagada,
                tiene_sancion_registrada: Boolean(sancion),
                estado: p.estado
            };
        });

        return res.status(200).json(reporte);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

module.exports = { getReportePrestamos };