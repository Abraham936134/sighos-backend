import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from './db.js';
import { consultarDNI } from './reniec.service.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function procesarPregunta(pregunta) {
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

  // Obtener esquema de la BD con tablas y columnas
  const columnas = await query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  
  const mapaTablas = {};
  columnas.rows.forEach(col => {
    if (!mapaTablas[col.table_name]) {
      mapaTablas[col.table_name] = [];
    }
    mapaTablas[col.table_name].push(col.column_name);
  });
  
  const esquema = Object.entries(mapaTablas)
    .map(([tabla, cols]) => `${tabla}(${cols.join(', ')})`)
    .join('; ');

  // Detectar si pregunta por un DNI
  const dniMatch = pregunta.match(/\d{8}/);
  let datosReniec = '';
  if (dniMatch) {
    try {
      const datos = await consultarDNI(dniMatch[0]);
      datosReniec = `Datos RENIEC del DNI ${dniMatch[0]}: ${JSON.stringify(datos)}`;
    } catch (e) {
      datosReniec = `No se pudo consultar RENIEC para DNI ${dniMatch[0]}`;
    }
  }

  const prompt = `
Eres un asistente de un sistema hospitalario llamado SIGHOS.
Tienes acceso a una base de datos PostgreSQL con las siguientes tablas: ${esquema}.
${datosReniec}

El usuario pregunta: "${pregunta}"

Si necesitas consultar la BD, genera SOLO un SELECT válido entre las etiquetas <SQL> y </SQL>.
Luego responde en lenguaje natural y amigable en español.
NUNCA uses INSERT, UPDATE, DELETE, DROP.
`;

  const result = await model.generateContent(prompt);
  const texto = result.response.text();

  // Extraer y ejecutar SQL si existe
  const sqlMatch = texto.match(/<SQL>([\s\S]*?)<\/SQL>/);
  let datosDB = null;
  if (sqlMatch) {
    try {
      const sql = sqlMatch[1].trim();
      const resultado = await query(sql);
      datosDB = resultado.rows;
    } catch (e) {
      datosDB = `Error ejecutando SQL: ${e.message}`;
    }
  }

  // Segunda llamada con los datos reales
  if (datosDB) {
    const prompt2 = `
El usuario preguntó: "${pregunta}"
Los datos de la base de datos son: ${JSON.stringify(datosDB)}
${datosReniec}
Responde de forma natural y amigable en español.
`;
    const result2 = await model.generateContent(prompt2);
    return result2.response.text();
  }

  return texto.replace(/<SQL>[\s\S]*?<\/SQL>/g, '').trim();
}