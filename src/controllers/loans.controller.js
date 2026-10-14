const supabase = require('../config/supabase');

const TABLA = 'prestamos';
const COL = {
    usuario: 'usuario_id',
    libro: 'libro_id',
    estado: 'estado',
    desde: 'fecha_prestamo',
    limite: 'fecha_devolucion_prevista',
    limiteTs: 'fecha_limite',
    devuelto: 'fecha_devolucion_real'
};
const ESTADO_ACTIVO = 'PRESTADO';
const ESTADO_DEVUELTO = 'DEVUELTO';
const DIAS_PRESTAMO = 14;

function fechaLocal(offsetDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDias);
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
}

function aFecha(valor, hora) {
    if (!valor) return null;
    return String(valor).includes('T')
        ? new Date(valor)
        : new Date(`${valor}T${hora}`);
}

const esActivo = p => String(p[COL.estado]).toUpperCase() === ESTADO_ACTIVO;

function estaVencido(p) {
    const limite = aFecha(p[COL.limite], '23:59:59');
    return esActivo(p) && limite && limite < new Date();
}

function normalizar(p, libro) {
    return {
        id: p.id,
        libro_id: p[COL.libro],
        titulo: libro?.titulo ?? 'Libro',
        autor: libro?.autor ?? '',
        fecha_prestamo: aFecha(p[COL.desde], '12:00:00')?.toISOString() ?? null,
        fecha_limite: aFecha(p[COL.limite], '23:59:59')?.toISOString() ?? null,
        fecha_devolucion: aFecha(p[COL.devuelto], '12:00:00')?.toISOString() ?? null,
        estado: esActivo(p) ? 'activo' : 'devuelto',
        vencido: !!estaVencido(p)
    };
}

const solicitar = async (req, res) => {
    try {
        const usuarioId = req.user.id;
        const libroId = parseInt(req.body.libro_id);

        if (!libroId) {
            return res.status(400).json({ error: 'El libro es obligatorio' });
        }

        const { data: libro, error: errorLibro } = await supabase
            .from('libros')
            .select('id, titulo, activo, cantidad_disponible')
            .eq('id', libroId)
            .maybeSingle();

        if (errorLibro) return res.status(500).json({ error: 'Error al consultar el libro' });
        if (!libro || !libro.activo) return res.status(404).json({ error: 'El libro no está disponible en el catálogo' });
        if (libro.cantidad_disponible < 1) return res.status(409).json({ error: 'No hay unidades disponibles de este libro' });

        const { data: activos, error: errorActivos } = await supabase
            .from(TABLA)
            .select('*')
            .eq(COL.usuario, usuarioId)
            .ilike(COL.estado, ESTADO_ACTIVO);

        if (errorActivos) return res.status(500).json({ error: 'Error al consultar tus préstamos' });

        if (activos.some(p => p[COL.libro] === libroId)) {
            return res.status(409).json({ error: 'Ya tienes este libro en préstamo' });
        }

        if (activos.some(estaVencido)) {
            return res.status(403).json({
                error: 'Tienes préstamos vencidos. Devuélvelos para solicitar nuevos libros'
            });
        }

        const limiteTs = new Date(Date.now() + DIAS_PRESTAMO * 24 * 60 * 60 * 1000);

        const { data: prestamo, error: errorInsert } = await supabase
            .from(TABLA)
            .insert([{
                [COL.usuario]: usuarioId,
                [COL.libro]: libroId,
                [COL.desde]: fechaLocal(),
                [COL.limite]: fechaLocal(DIAS_PRESTAMO),
                [COL.limiteTs]: limiteTs.toISOString(),
                [COL.estado]: ESTADO_ACTIVO
            }])
            .select('*')
            .single();

        if (errorInsert) {
            console.error(errorInsert);
            return res.status(500).json({ error: 'No se pudo registrar el préstamo' });
        }

        const { error: errorStock } = await supabase
            .from('libros')
            .update({ cantidad_disponible: libro.cantidad_disponible - 1 })
            .eq('id', libroId);

        if (errorStock) {
            await supabase.from(TABLA).delete().eq('id', prestamo.id);
            return res.status(500).json({ error: 'No se pudo actualizar el inventario' });
        }

        return res.status(201).json({
            mensaje: 'Préstamo solicitado correctamente',
            prestamo: normalizar(prestamo, libro)
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// GET /api/loans/mine
const misPrestamos = async (req, res) => {
    try {
        const { data: prestamos, error } = await supabase
            .from(TABLA)
            .select('*')
            .eq(COL.usuario, req.user.id)
            .order(COL.desde, { ascending: false });

        if (error) return res.status(500).json({ error: 'Error al consultar tus préstamos' });
        if (!prestamos.length) return res.status(200).json([]);

        const ids = [...new Set(prestamos.map(p => p[COL.libro]))];
        const { data: libros } = await supabase
            .from('libros')
            .select('id, titulo, autor')
            .in('id', ids);

        const porId = new Map((libros || []).map(l => [l.id, l]));

        return res.status(200).json(
            prestamos.map(p => normalizar(p, porId.get(p[COL.libro])))
        );

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

const devolver = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const { data: prestamo, error } = await supabase
            .from(TABLA)
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) return res.status(500).json({ error: 'Error al consultar el préstamo' });
        if (!prestamo) return res.status(404).json({ error: 'Préstamo no encontrado' });

        const esDueño = prestamo[COL.usuario] === req.user.id;
        if (!esDueño && req.user.rol !== 'Administrador') {
            return res.status(403).json({ error: 'No puedes devolver el préstamo de otra persona' });
        }

        if (!esActivo(prestamo)) {
            return res.status(409).json({ error: 'Este préstamo ya fue devuelto' });
        }

        const { error: errorUpdate } = await supabase
            .from(TABLA)
            .update({
                [COL.estado]: ESTADO_DEVUELTO,
                [COL.devuelto]: fechaLocal()
            })
            .eq('id', id);

        if (errorUpdate) {
            console.error(errorUpdate);
            return res.status(500).json({ error: 'No se pudo registrar la devolución' });
        }

        const { data: libro } = await supabase
            .from('libros')
            .select('cantidad_disponible, cantidad_total')
            .eq('id', prestamo[COL.libro])
            .maybeSingle();

        if (libro) {
            await supabase
                .from('libros')
                .update({
                    cantidad_disponible: Math.min(libro.cantidad_disponible + 1, libro.cantidad_total)
                })
                .eq('id', prestamo[COL.libro]);
        }

        return res.status(200).json({ mensaje: 'Libro devuelto correctamente' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};

module.exports = { solicitar, misPrestamos, devolver };