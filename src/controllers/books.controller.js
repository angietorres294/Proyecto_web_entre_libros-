const supabase = require('../config/supabase');

const getBooks = async (req, res) => {
  try {
    const { titulo, autor, categoria } = req.query;
    let query = supabase.from('libros').select('*');

    if (titulo && titulo.trim() !== '') {
      query = query.ilike('titulo', `%${titulo.trim()}%`);
    }
    if (autor && autor.trim() !== '') {
      query = query.ilike('autor', `%${autor.trim()}%`);
    }
    if (categoria && categoria.trim() !== '') {
      query = query.ilike('categoria', `%${categoria.trim()}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error de Supabase:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error('Error en el servidor:', err);
    return res.status(500).json({ error: err.message });
  }
};

const createBook = async (req, res) => {
  try {
    const { count, error: countError } = await supabase
      .from('libros')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      return res.status(500).json({ error: 'Error al verificar el total de libros.' });
    }

    if (count >= 50) {
      return res.status(400).json({ 
        error: 'Se ha alcanzado el límite máximo permitido de 50 libros ingresados en el catálogo.' 
      });
    }

    const { titulo, autor, categoria, editorial, año_publicacion, isbn, cantidad_total } = req.body;

    const { data, error } = await supabase.from('libros').insert([
      {
        titulo,
        autor,
        categoria,
        editorial,
        año_publicacion,
        isbn,
        cantidad_total,
        cantidad_disponible: cantidad_total,
        activo: true
      }
    ]).select();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(data[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const updateBook = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.cantidad_total !== undefined) {
      const { data: libroActual, error: errorConsultar } = await supabase
        .from('libros')
        .select('cantidad_total, cantidad_disponible')
        .eq('id', id)
        .maybeSingle();

      if (errorConsultar || !libroActual) {
        return res.status(404).json({ error: 'Libro no encontrado para actualizar.' });
      }

      const prestadosActuales = (libroActual.cantidad_total || 0) - (libroActual.cantidad_disponible || 0);
      const nuevaCantidadTotal = parseInt(updates.cantidad_total);

      if (nuevaCantidadTotal < prestadosActuales) {
        return res.status(400).json({
          error: `No puedes reducir el inventario a ${nuevaCantidadTotal} porque hay ${prestadosActuales} ejemplares actualmente prestados.`
        });
      }

      updates.cantidad_disponible = nuevaCantidadTotal - prestadosActuales;
    }

    const { data, error } = await supabase
      .from('libros')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json(data[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const inactivateBook = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('libros')
      .update({ activo: false })
      .eq('id', id)
      .select();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ mensaje: 'Libro inactivado correctamente', libro: data[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const getBooksReport = async (req, res) => {
  try {
    const { data: libros, error } = await supabase
      .from('libros')
      .select('*')
      .order('id', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    const totalIngresados = (libros || []).length;
    const activos = (libros || []).filter(l => l.activo === true || l.activo === 'true').length;
    const inactivos = (libros || []).filter(l => l.activo === false || l.activo === 'false').length;

    return res.status(200).json({
      resumen: {
        totalIngresados,
        limitePermitido: 50,
        activos,
        inactivos
      },
      libros: libros || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getBooks,
  createBook,
  updateBook,
  inactivateBook,
  getBooksReport
};