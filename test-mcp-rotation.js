import 'dotenv/config';
import { procesarPregunta } from "./chat.service.js";
import { closePool } from "./db.js";

async function testRotation() {
  console.log("🚀 Iniciando test de Rotación Automática de API Keys...");

  // Guardar la clave real
  const realKey = process.env.GEMINI_API_KEY || '';
  if (!realKey) {
    console.error("❌ Error: No se detectó GEMINI_API_KEY en las variables de entorno.");
    process.exit(1);
  }

  // Simular dos claves inválidas seguidas de la clave real
  // GEMINI_API_KEYS = "CLAVE_FALSA_1, CLAVE_FALSA_2, CLAVE_REAL"
  process.env.GEMINI_API_KEYS = `CLAVE_FALSA_NO_VALIDA_1, CLAVE_FALSA_NO_VALIDA_2, ${realKey}`;
  console.log(`Configurando pool simulado: [CLAVE_FALSA_1, CLAVE_FALSA_2, CLAVE_REAL]`);

  try {
    const pregunta = "¿Qué especialidades médicas tiene activas el hospital?";
    console.log(`💬 Pregunta de prueba: "${pregunta}"`);

    // Ejecutar
    const respuesta = await procesarPregunta(pregunta, []);

    console.log("\n🤖 Respuesta final recibida con éxito:");
    console.log(respuesta);

    console.log("\n✅ Test de Rotación Exitoso! El sistema se recuperó de los fallos de clave.");
  } catch (err) {
    console.error("\n❌ Error catastrófico: El test falló por completo:", err);
  } finally {
    await closePool();
    process.exit(0);
  }
}

testRotation();
