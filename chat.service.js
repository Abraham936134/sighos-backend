import { GoogleGenerativeAI } from '@google/generative-ai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp.server.js";

// Parsear la lista de API Keys separadas por comas (GEMINI_API_KEYS) o usar GEMINI_API_KEY como fallback
let currentKeyIndex = 0;

export async function procesarPregunta(pregunta, historial = [], reintentos = 0) {
  // Cargar las claves dinámicamente en cada petición para soportar cambios en caliente
  const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);

  if (API_KEYS.length === 0) {
    throw new Error("No se ha configurado ninguna clave API en GEMINI_API_KEYS o GEMINI_API_KEY.");
  }
  if (reintentos >= API_KEYS.length) {
    throw new Error("Todas las API Keys de Gemini configuradas han agotado su cuota o son inválidas.");
  }

  const apiKey = API_KEYS[currentKeyIndex];
  console.log(`[gemini-client] Iniciando consulta usando API Key índice ${currentKeyIndex} (${apiKey.substring(0, 8)}...)`);
  const genAI = new GoogleGenerativeAI(apiKey);

  let clientTransport, serverTransport, mcpServer, client;

  try {
    // 1. Instanciar transportes de MCP en memoria conectados entre sí (canal bidireccional)
    const linkedPair = InMemoryTransport.createLinkedPair();
    clientTransport = linkedPair[0];
    serverTransport = linkedPair[1];

    // 2. Levantar una instancia aislada del Servidor MCP y conectarle su transporte
    mcpServer = createMcpServer();
    await mcpServer.connect(serverTransport);

    // 3. Inicializar el Cliente MCP y conectarle su transporte
    client = new Client(
      { name: "sighos-mcp-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);

    // 4. Descubrimiento de herramientas mediante el protocolo estándar MCP
    const toolsResponse = await client.listTools();
    const mcpTools = toolsResponse.tools || [];

    // Mapear dinámicamente las herramientas de MCP al formato que espera Gemini
    const functionDeclarations = mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: (tool.inputSchema.type || 'object').toUpperCase(),
        properties: tool.inputSchema.properties,
        required: tool.inputSchema.required
      }
    }));

    const fechaActual = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima' }) + ' ' + new Date().toLocaleTimeString('es-PE', { timeZone: 'America/Lima' });

    const systemInstruction = `
Eres el asistente virtual oficial de SIGHOS, un sistema inteligente de gestión hospitalaria de vanguardia.
Tienes acceso a la base de datos de SIGHOS (cuyo esquema se detalla abajo) y a herramientas para consultar la base de datos (SELECT), realizar búsquedas de ciudadanos en la RENIEC y agendar citas médicas de forma segura.

REGLAS DE INTERACCIÓN:
1. Para obtener datos de la base de datos, llama a la herramienta 'consultarBaseDeDatos' pasando la consulta SELECT correspondiente.
2. Para buscar personas por DNI que no conozcas o para validar identidades, llama a la herramienta 'consultarRENIEC'.
3. Para agendar una cita médica, llama a la herramienta 'agendarCita'. Esta función también registrará automáticamente al paciente con sus datos de la RENIEC si el DNI no está registrado aún.
4. Responde siempre de forma amable, servicial y profesional en español.
5. Si vas a mostrar una lista de múltiples registros (por ejemplo, médicos, servicios, citas o especialidades), DEBES presentarlos utilizando tablas de Markdown bien formateadas con sus respectivas columnas (por ejemplo: | Código | Nombre | Especialidad | Estado |) para facilitar la lectura. No uses listas simples si hay más de 2 registros.
6. Fecha y hora actual del servidor: ${fechaActual}. Utiliza este dato para calcular fechas relativas como 'mañana', 'el lunes', etc., al agendar citas.
7. Al buscar personal médico en la tabla 'personal', ten en cuenta que los médicos tienen el rol 'EMPLEADO'. NUNCA uses 'MEDICO' en el filtro de la columna 'rol' (usa 'EMPLEADO' o simplemente no filtres por rol si ya filtras por especialidad).

ESQUEMA DE LA BASE DE DATOS SIGHOS:
- Tabla 'especialidades':
  * id_especialidad (integer)
  * codigo_display (character varying)
  * nombre (character varying) - Ej. 'Oftalmología', 'Pediatría', 'Cardiología'
  * descripcion (text)
  * estado (character varying) - 'ACTIVO', 'INACTIVO'

- Tabla 'servicios':
  * id_servicio (integer)
  * codigo_display (character varying)
  * nombre (character varying) - Nombre del servicio médico (ej. 'Consulta de Pediatría', 'Examen de Rayos X')
  * tipo (character varying) - 'CONSULTA', 'EXAMEN', 'PROCEDIMIENTO'
  * id_especialidad (integer) - Enlace a la especialidad
  * precio (numeric)
  * descripcion (text)
  * estado (character varying) - 'ACTIVO', 'INACTIVO'

- Tabla 'pacientes':
  * id_paciente (integer)
  * codigo_display (character varying) - Formato 'PAC-001'
  * dni (character varying)
  * nombre_completo (character varying)
  * sexo (character varying)
  * fecha_nacimiento (date)
  * celular (character varying)
  * correo (character varying)
  * direccion (text)

- Tabla 'personal': (Médicos y trabajadores del hospital)
  * id_trabajador (integer)
  * codigo_display (character varying) - Formato 'PER-001'
  * dni (character varying)
  * nombre_completo (character varying)
  * id_especialidad (integer)
  * estado (character varying) - 'ACTIVO', 'INACTIVO'
  * celular (character varying)
  * correo (character varying)
  * direccion (text)
  * salario (numeric)
  * rol (character varying) - 'ADMINISTRADOR', 'EMPLEADO' (este rol corresponde a los médicos y trabajadores médicos en la base de datos), 'RECEPCIONISTA'

- Tabla 'citas':
  * id_cita (integer)
  * codigo_display (character varying) - Formato 'CIT-001'
  * id_paciente (integer)
  * id_servicio (integer)
  * estado (character varying) - 'EN ESPERA', 'COMPLETADA', 'CANCELADA'
  * fecha_cita (timestamp without time zone)
  * fecha_registro_sistema (timestamp without time zone)
`;

    // Configuración del modelo con tools de Gemini mapeadas desde MCP
    const model = genAI.getGenerativeModel({
      // Optimización de cuota: migrado de gemini-2.5-flash (límite de 20 req/día) 
      // a gemini-flash-lite-latest (límite ampliado de 1,500 req/día y 15 RPM en capa gratuita)
      model: 'gemini-flash-lite-latest',
      systemInstruction,
      tools: [
        {
          functionDeclarations: functionDeclarations
        }
      ],
    });

    // Limpiar y estructurar el historial para que alterne estrictamente y comience con 'user'
    const cleanHistory = [];
    let userFound = false;
    for (const msg of historial) {
      const role = msg.sender === 'user' ? 'user' : 'model';
      if (role === 'user') {
        userFound = true;
      }
      if (userFound) {
        if (cleanHistory.length === 0 || cleanHistory[cleanHistory.length - 1].role !== role) {
          cleanHistory.push({
            role,
            parts: [{ text: msg.text }]
          });
        }
      }
    }

    // Iniciar la sesión de chat con el historial limpio
    const chat = model.startChat({
      history: cleanHistory,
    });

    // Enviar el nuevo mensaje a la conversación
    let result = await chat.sendMessage(pregunta);

    // Ciclo para procesar llamadas a funciones (Tools) solicitadas por Gemini
    let calls = (typeof result.response.functionCalls === 'function')
      ? result.response.functionCalls()
      : result.response.functionCalls;

    while (calls && calls.length > 0) {
      const functionResponses = [];

      for (const call of calls) {
        const { name, args } = call;
        let functionResult;

        try {
          console.log(`[mcp-client] Redirigiendo ejecución de herramienta "${name}" al Servidor MCP...`);
          
          // Petición formal a través del protocolo estándar MCP
          const mcpResponse = await client.callTool({
            name,
            arguments: args
          });

          // Extraer el texto de la respuesta de MCP
          const resultText = mcpResponse.content && mcpResponse.content[0] ? mcpResponse.content[0].text : '';
          try {
            functionResult = JSON.parse(resultText);
          } catch {
            functionResult = { result: resultText };
          }
        } catch (err) {
          console.error(`❌ Error al invocar herramienta en Servidor MCP "${name}":`, err.message);
          functionResult = { error: err.message };
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: { result: functionResult }
          }
        });
      }

      // Enviar las respuestas de ejecución de herramientas de vuelta a Gemini
      result = await chat.sendMessage(functionResponses);

      // Evaluar si Gemini requiere más llamadas a herramientas subsecuentes
      calls = (typeof result.response.functionCalls === 'function')
        ? result.response.functionCalls()
        : result.response.functionCalls;
    }

    // Cerrar la sesión del cliente y del servidor MCP de manera segura para liberar recursos
    try {
      await client.close();
      await mcpServer.close();
    } catch (err) {
      console.error("Error al cerrar transportes MCP:", err.message);
    }

    // Retornar el texto final generado por Gemini
    return result.response.text();

  } catch (error) {
    // En caso de error, asegurar que los transportes MCP se cierren para no dejar sockets abiertos
    try {
      if (client) await client.close();
      if (mcpServer) await mcpServer.close();
    } catch (mcpCloseErr) {
      console.error("Error al forzar cierre de MCP en catch:", mcpCloseErr.message);
    }

    // Detectar si el error es debido a límites de cuota (429) o credenciales de clave inválidas
    const isRateLimit = error.status === 429 || 
                        (error.message && (
                          error.message.includes("429") || 
                          error.message.includes("RESOURCE_EXHAUSTED") || 
                          error.message.includes("API key not valid") || 
                          error.message.includes("API_KEY_INVALID")
                        ));

    if (isRateLimit) {
      console.warn(`⚠️ [gemini-quota] API Key índice ${currentKeyIndex} agotada o inválida. Rotando clave...`);
      // Rotar circularmente al siguiente índice
      currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;

      // Reintentar de manera recursiva la llamada con la siguiente API Key
      return procesarPregunta(pregunta, historial, reintentos + 1);
    }

    // Si es un error de negocio u otra cosa, lanzarlo
    throw error;
  }
}