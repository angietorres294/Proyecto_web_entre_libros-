const supabase = require('../config/supabase');

const getReportePrestamos = async (req, res) => {
    try {
        
        const { data: prestamos, error: errorPrestamos } = await supabase
            .from('prestamos')
            .select('*')
            .order('fecha_prestamo', { ascending: false });

        if (errorPrestamos) {
            console.error(errorPrestamos);
            return res.status(500).json({ error: 'Error al consultar el reporte de préstamos.' });
        }

        if (!prestamos || prestamos.length === 0) {
            return res.status(200).json([]);
        }

        const usuariosIds = [...new Set(prestamos.map(p => p.usuario_id))];
        const librosIds = [...new Set(prestamos.map(p => p.libro_id))];

        const { data: usuarios } = await supabase
            .from('usuarios')
            .select('id, nombre, apellido, correo, rol')
            .in('id', usuariosIds);

        const { data: libros } = await supabase
            .from('libros')
            .select('id, titulo, autor')
            .in('id', librosIds);

         const mapUsuarios = new Map((usuarios || []).map(u => [u.id, u]));
         const mapLibros = new Map((libros || []).map(l => [l.id, l]));

         const reporte = prestamos.map(p => {
         const usr = mapUsuarios.get(p.usuario_id);
         const lib = mapLibros.get(p.libro_id);

         const fInicio = new Date(p.fecha_prestamo);
         const fLimite = new Date(p.fecha_devolucion_prevista || p.fecha_limite);
         const fDev = p.fecha_devolucion_real ? new Date(p.fecha_devolucion_real) : null;

         const diffTime = Math.abs((fDev || new Date()) - fInicio);
         const diasDuracion = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            return {
                id: p.id,
                usuario_nombre: usr ? `${usr.nombre} ${usr.apellido}`.trim() : 'Usuario Desconocido',
                usuario_correo: usr?.correo || 'Sin correo',
                usuario_rol: usr?.rol || 'Cliente',
                libro_titulo: lib?.titulo || 'Libro desconocido',
                libro_autor: lib?.autor || '—',
                fecha_prestamo: p.fecha_prestamo,
                fecha_limite: p.fecha_devolucion_prevista || p.fecha_limite,
                fecha_devolucion: p.fecha_devolucion_real,
                dias_transcurridos: diasDuracion,
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