import { GoogleGenerativeAI } from '@google/generative-ai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp.server.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function procesarPregunta(pregunta, historial = []) {
  // 1. Instanciar transportes de MCP en memoria conectados entre sí (canal bidireccional)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // 2. Levantar una instancia aislada del Servidor MCP y conectarle su transporte
  const mcpServer = createMcpServer();
  await mcpServer.connect(serverTransport);

  // 3. Inicializar el Cliente MCP y conectarle su transporte
  const client = new Client(
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
    // Arquitectura de Integración Segura: Se utiliza Function Calling nativo (tools) de Gemini
    // alimentado por los esquemas obtenidos directamente de nuestro Servidor MCP en memoria.
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
}