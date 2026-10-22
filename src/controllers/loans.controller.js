const supabase = require('../config/supabase');

const TABLA = 'prestamos';

function fechaLocal(offsetDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDias);
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

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
            return res.status(409).json({ error: 'El libro no cuenta con unidades disponibles' });
        }

        const { data: prestamosUsuario } = await supabase
            .from(TABLA)
            .select('*')
            .eq('usuario_id', usuarioId);

        const activos = (prestamosUsuario || []).filter(p => 
            String(p.estado).toUpperCase() === 'PRESTADO' || 
            String(p.estado).toUpperCase() === 'SOLICITADO'
        );

        if (activos.length >= 3) {
            return res.status(409).json({ error: 'Solo puedes tener un máximo de 3 préstamos simultáneos.' });
        }

        if (activos.some(p => p.libro_id === libroId)) {
            return res.status(409).json({ error: 'Ya tienes este libro actualmente prestado o con solicitud en curso.' });
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
                estado: 'PRESTADO'
            }])
            .select()
            .single();

        if (errorInsert) {
            console.error('Error insertando en Supabase:', errorInsert);
            return res.status(500).json({ error: 'No se pudo registrar el préstamo: ' + errorInsert.message });
        }

        await supabase
            .from('libros')
            .update({ cantidad_disponible: Math.max(0, (libro.cantidad_disponible || 1) - 1) })
            .eq('id', libroId);

        return res.status(201).json({
            mensaje: 'Préstamo solicitado exitosamente.',
            prestamo
        });

    } catch (err) {
        console.error('Error interno:', err);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

const misPrestamos = async (req, res) => {
    try {
        const usuarioId = req.user?.id || req.user?.usuarioId || req.user?.usuario_id;
        const { data: prestamos, error } = await supabase
            .from(TABLA)
            .select('*')
            .eq('usuario_id', usuarioId)
            .order('fecha_prestamo', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });
        if (!prestamos || !prestamos.length) return res.status(200).json([]);

        const ids = [...new Set(prestamos.map(p => p.libro_id))];
        const { data: libros } = await supabase.from('libros').select('id, titulo, autor').in('id', ids);

        const mapaLibros = new Map((libros || []).map(l => [l.id, l]));

        const resultado = prestamos.map(p => {
            const l = mapaLibros.get(p.libro_id);
            const est = String(p.estado).toUpperCase();
            let estadoNorm = 'devuelto';
            if (est === 'PRESTADO' || est === 'ACTIVO') estadoNorm = 'activo';
            else if (est === 'SOLICITADO') estadoNorm = 'solicitado';

            return {
                id: p.id,
                libro_id: p.libro_id,
                titulo: l ? l.titulo : 'Libro #' + p.libro_id,
                autor: l ? l.autor : '',
                fecha_prestamo: p.fecha_prestamo,
                fecha_limite: p.fecha_devolucion_prevista || p.fecha_limite,
                fecha_devolucion: p.fecha_devolucion_real || p.fecha_devolucion,
                estado: estadoNorm
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
        const { data: usuarios } = await supabase.from('usuarios').select('id, nombre, email').in('id', usuarioIds);

        const mapaLibros = new Map((libros || []).map(l => [l.id, l]));
        const mapaUsuarios = new Map((usuarios || []).map(u => [u.id, u]));

        return res.status(200).json(prestamos.map(p => ({
            id: p.id,
            usuario_nombre: mapaUsuarios.get(p.usuario_id)?.nombre || 'Usuario ' + p.usuario_id,
            usuario_email: mapaUsuarios.get(p.usuario_id)?.email || '',
            libro_titulo: mapaLibros.get(p.libro_id)?.titulo || 'Libro #' + p.libro_id,
            fecha_prestamo: p.fecha_prestamo
        })));
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

const aprobarDevolucion = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { data: prestamo } = await supabase.from(TABLA).select('*').eq('id', id).maybeSingle();

        if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' });

        await supabase.from(TABLA).update({ estado: 'DEVUELTO', fecha_devolucion_real: fechaLocal() }).eq('id', id);

        const { data: libro } = await supabase.from('libros').select('cantidad_disponible, cantidad_total').eq('id', prestamo.libro_id).maybeSingle();

        if (libro) {
            await supabase.from('libros').update({
                cantidad_disponible: Math.min((libro.cantidad_disponible || 0) + 1, libro.cantidad_total || 1)
            }).eq('id', prestamo.libro_id);
        }

        return res.status(200).json({ mensaje: 'Devolución aceptada correctamente.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

module.exports = { solicitar, misPrestamos, devolver, solicitudesPendientes, aprobarDevolucion };