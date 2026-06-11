import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from './db.js';
import { consultarDNI } from './reniec.service.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

export async function procesarPregunta(pregunta, historial = []) {
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
  * rol (character varying) - 'ADMINISTRADOR', 'MEDICO', 'RECEPCIONISTA'

- Tabla 'citas':
  * id_cita (integer)
  * codigo_display (character varying) - Formato 'CIT-001'
  * id_paciente (integer)
  * id_servicio (integer)
  * estado (character varying) - 'EN ESPERA', 'COMPLETADA', 'CANCELADA'
  * fecha_cita (timestamp without time zone)
  * fecha_registro_sistema (timestamp without time zone)
`;

  // Configuración del modelo con tools de Gemini
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-lite-latest',
    systemInstruction,
    tools: [
      {
        functionDeclarations: [
          {
            name: 'consultarBaseDeDatos',
            description: 'Ejecuta una consulta SQL SELECT (y solo de lectura SELECT) sobre la base de datos de SIGHOS para obtener información de médicos, pacientes, citas, especialidades o servicios.',
            parameters: {
              type: 'OBJECT',
              properties: {
                sqlQuery: {
                  type: 'STRING',
                  description: 'Consulta SQL SELECT de lectura válida. NUNCA uses comandos de escritura.',
                },
              },
              required: ['sqlQuery'],
            },
          },
          {
            name: 'consultarRENIEC',
            description: 'Busca los nombres y apellidos de un ciudadano peruano en la RENIEC usando su DNI de 8 dígitos.',
            parameters: {
              type: 'OBJECT',
              properties: {
                dni: {
                  type: 'STRING',
                  description: 'El DNI de 8 dígitos del ciudadano.',
                },
              },
              required: ['dni'],
            },
          },
          {
            name: 'agendarCita',
            description: 'Agenda una cita médica en la base de datos de SIGHOS y registra al paciente automáticamente en pacientes si no está registrado.',
            parameters: {
              type: 'OBJECT',
              properties: {
                dniPaciente: {
                  type: 'STRING',
                  description: 'DNI de 8 dígitos del paciente.',
                },
                idServicio: {
                  type: 'NUMBER',
                  description: 'ID numérico del servicio o consulta médica.',
                },
                fecha: {
                  type: 'STRING',
                  description: 'Fecha de la cita en formato YYYY-MM-DD.',
                },
                hora: {
                  type: 'STRING',
                  description: 'Hora de la cita en formato HH:MM (24 horas).',
                },
              },
              required: ['dniPaciente', 'idServicio', 'fecha', 'hora'],
            },
          },
        ],
      },
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

  // Ciclo para procesar llamadas a funciones (Tools) repetitivas solicitadas por Gemini
  let calls = (typeof result.response.functionCalls === 'function')
    ? result.response.functionCalls()
    : result.response.functionCalls;

  while (calls && calls.length > 0) {
    const functionResponses = [];

    for (const call of calls) {
      const { name, args } = call;
      let functionResult;

      try {
        if (name === 'consultarBaseDeDatos') {
          const { sqlQuery } = args;
          if (!sqlQuery.trim().toUpperCase().startsWith('SELECT')) {
            functionResult = { error: 'Solo se permiten consultas de lectura (SELECT).' };
          } else {
            const dbRes = await query(sqlQuery);
            functionResult = { rows: dbRes.rows };
          }
        } else if (name === 'consultarRENIEC') {
          const { dni } = args;
          const datos = await consultarDNI(dni);
          functionResult = datos;
        } else if (name === 'agendarCita') {
          const { dniPaciente, idServicio, fecha, hora } = args;
          const resBooking = await ejecutarAgendarCita(dniPaciente, idServicio, fecha, hora);
          functionResult = resBooking;
        } else {
          functionResult = { error: `Función desconocida: ${name}` };
        }
      } catch (err) {
        console.error(`❌ Error ejecutando Tool "${name}":`, err.message);
        functionResult = { error: err.message };
      }

      functionResponses.push({
        functionResponse: {
          name,
          response: { result: functionResult }
        }
      });
    }

    // Enviar las respuestas de ejecución a Gemini para que continúe la respuesta
    result = await chat.sendMessage(functionResponses);

    // Volver a evaluar si hay llamadas de funciones subsecuentes
    calls = (typeof result.response.functionCalls === 'function')
      ? result.response.functionCalls()
      : result.response.functionCalls;
  }

  // Retornar el texto final generado por Gemini
  return result.response.text();
}