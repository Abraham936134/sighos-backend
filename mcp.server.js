import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { query } from "./db.js";
import { consultarDNI } from "./reniec.service.js";

// Función interna y segura para agendar citas con auto-registro si el paciente no existe
async function ejecutarAgendarCita(dniPaciente, idServicio, fecha, hora) {
  if (!/^\d{8}$/.test(dniPaciente)) {
    throw new Error('El DNI debe tener exactamente 8 dígitos.');
  }

  // 1. Verificar servicio
  const sRes = await query('SELECT nombre, precio FROM servicios WHERE id_servicio = $1', [idServicio]);
  if (sRes.rows.length === 0) {
    throw new Error(`El servicio con ID ${idServicio} no existe en SIGHOS.`);
  }
  const servicio = sRes.rows[0];

  // 2. Buscar paciente
  let pRes = await query('SELECT id_paciente, nombre_completo, codigo_display FROM pacientes WHERE dni = $1', [dniPaciente]);
  let pacienteId;
  let pacienteNombre;
  let pacienteCodigo;
  let autoRegistrado = false;

  if (pRes.rows.length > 0) {
    pacienteId = pRes.rows[0].id_paciente;
    pacienteNombre = pRes.rows[0].nombre_completo;
    pacienteCodigo = pRes.rows[0].codigo_display;
  } else {
    // Buscar en RENIEC para auto-registro
    try {
      const datosReniec = await consultarDNI(dniPaciente);
      pacienteNombre = datosReniec.nombreCompleto;
      autoRegistrado = true;

      // Calcular correlativo PAC-XXX
      const maxPacRes = await query("SELECT MAX(CAST(SUBSTRING(codigo_display, 5) AS INTEGER)) as max_num FROM pacientes WHERE codigo_display LIKE 'PAC-%'");
      const maxNum = maxPacRes.rows[0].max_num || 0;
      pacienteCodigo = 'PAC-' + String(maxNum + 1).padStart(3, '0');

      // Insertar nuevo paciente
      const newPacRes = await query(
        `INSERT INTO pacientes (codigo_display, dni, nombre_completo, celular, correo, direccion, password, fecha_registro)
         VALUES ($1, $2, $3, 'N/D', 'N/D', 'N/D', $4, CURRENT_TIMESTAMP)
         RETURNING id_paciente`,
        [pacienteCodigo, dniPaciente, pacienteNombre, dniPaciente]
      );
      pacienteId = newPacRes.rows[0].id_paciente;
    } catch (reniecErr) {
      throw new Error(`El paciente con DNI ${dniPaciente} no está registrado en el hospital y no pudo ser consultado en RENIEC: ${reniecErr.message}`);
    }
  }

  // 3. Calcular correlativo de cita CIT-XXX
  const maxCitRes = await query("SELECT MAX(CAST(SUBSTRING(codigo_display, 5) AS INTEGER)) as max_num FROM citas WHERE codigo_display LIKE 'CIT-%'");
  const maxCitNum = maxCitRes.rows[0].max_num || 0;
  const citaCodigo = 'CIT-' + String(maxCitNum + 1).padStart(3, '0');

  // 4. Insertar cita
  const timestampCita = `${fecha} ${hora}:00`;
  await query(
    `INSERT INTO citas (codigo_display, id_paciente, id_servicio, estado, fecha_cita, fecha_registro_sistema)
     VALUES ($1, $2, $3, 'EN ESPERA', $4, CURRENT_TIMESTAMP)`,
    [citaCodigo, pacienteId, idServicio, timestampCita]
  );

  return {
    success: true,
    message: 'Cita agendada exitosamente.',
    codigoCita: citaCodigo,
    codigoPaciente: pacienteCodigo,
    nombrePaciente: pacienteNombre,
    servicio: servicio.nombre,
    precio: Number(servicio.precio),
    fecha: fecha,
    hora: hora,
    autoRegistrado
  };
}

// Generador de instancias aisladas del Servidor MCP por petición
export function createMcpServer() {
  const mcpServer = new Server(
    {
      name: "sighos-mcp-server",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Registrar herramientas disponibles en el Servidor MCP
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "consultarBaseDeDatos",
          description: "Ejecuta una consulta SQL SELECT de lectura sobre cualquiera de las tablas de la base de datos de SIGHOS, incluyendo especialidades, servicios, pacientes, personal, citas, horarios_laborales e historial_clinico.",
          inputSchema: {
            type: "object",
            properties: {
              sqlQuery: {
                type: "string",
                description: "Consulta SQL SELECT de lectura válida. NUNCA uses comandos de escritura."
              }
            },
            required: ["sqlQuery"]
          }
        },
        {
          name: "consultarRENIEC",
          description: "Busca los nombres y apellidos de un ciudadano peruano en la RENIEC usando su DNI de 8 dígitos.",
          inputSchema: {
            type: "object",
            properties: {
              dni: {
                type: "string",
                description: "El DNI de 8 dígitos del ciudadano."
              }
            },
            required: ["dni"]
          }
        },
        {
          name: "agendarCita",
          description: "Agenda una cita médica en la base de datos de SIGHOS y registra al paciente automáticamente en pacientes si no está registrado.",
          inputSchema: {
            type: "object",
            properties: {
              dniPaciente: {
                type: "string",
                description: "DNI de 8 dígitos del paciente."
              },
              idServicio: {
                type: "number",
                description: "ID numérico del servicio o consulta médica."
              },
              fecha: {
                type: "string",
                description: "Fecha de la cita en formato YYYY-MM-DD."
              },
              hora: {
                type: "string",
                description: "Hora de la cita en formato HH:MM (24 horas)."
              }
            },
            required: ["dniPaciente", "idServicio", "fecha", "hora"]
          }
        }
      ]
    };
  });

  // Manejar ejecuciones de herramientas en el Servidor MCP
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "consultarBaseDeDatos") {
        const { sqlQuery } = args;
        console.log(`[mcp-server-sql] Ejecutando query: ${sqlQuery}`);
        if (!sqlQuery.trim().toUpperCase().startsWith('SELECT')) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: 'Solo se permiten consultas de lectura (SELECT).' }) }]
          };
        }
        const dbRes = await query(sqlQuery);
        console.log(`[mcp-server-sql] Retornó ${dbRes.rows ? dbRes.rows.length : 0} filas.`);
        return {
          content: [{ type: "text", text: JSON.stringify({ rows: dbRes.rows }) }]
        };
      }

      if (name === "consultarRENIEC") {
        const { dni } = args;
        const datos = await consultarDNI(dni);
        return {
          content: [{ type: "text", text: JSON.stringify(datos) }]
        };
      }

      if (name === "agendarCita") {
        const { dniPaciente, idServicio, fecha, hora } = args;
        const resBooking = await ejecutarAgendarCita(dniPaciente, idServicio, fecha, hora);
        return {
          content: [{ type: "text", text: JSON.stringify(resBooking) }]
        };
      }

      throw new Error(`Herramienta no encontrada: ${name}`);
    } catch (err) {
      console.error(`❌ Error en herramienta MCP "${name}":`, err.message);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }]
      };
    }
  });

  return mcpServer;
}
