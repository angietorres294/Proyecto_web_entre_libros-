const { createClient } = require('@supabase/supabase-js');

// Credenciales del archivo .env 

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey); // Conexión con la base de datos 

module.exports = supabase;