import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, testConnection } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const apiPort = Number(process.env.PORT || process.env.API_PORT || 3001);
const apiHost = process.env.API_HOST || '0.0.0.0';

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());

const toDbStatus = (status) =>
  String(status || 'ACTIVO').toUpperCase() === 'INACTIVO' ? 'INACTIVO' : 'ACTIVO';

const parsePrice = (rawPrice) => {
  if (typeof rawPrice === 'number' && Number.isFinite(rawPrice)) {
    return Number(rawPrice.toFixed(2));
  }

  if (typeof rawPrice !== 'string') {
    throw new Error('El campo precio es obligatorio.');
  }

  const normalized = rawPrice.replace(/[^\d,.-]/g, '').replace(',', '.');
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error('Formato de precio invalido.');
  }

  return Number(parsed.toFixed(2));
};

const getRateById = async (serviceId, tipo = 'CONSULTA') => {
  const { rows } = await query(
    `
      SELECT
        s.id_servicio,
        s.codigo_display,
        s.nombre,
        s.tipo,
        s.precio,
        s.descripcion,
        s.estado,
        s.id_especialidad,
        e.nombre AS especialidad
      FROM servicios s
      INNER JOIN especialidades e ON e.id_especialidad = s.id_especialidad
      WHERE s.id_servicio = $1 AND s.tipo = $2
      LIMIT 1
    `,
    [serviceId, tipo],
  );

  return rows[0] || null;
};

const getSpecialtyIdByName = async (specialtyName) => {
  const { rows } = await query(
    `
      SELECT id_especialidad
      FROM especialidades
      WHERE LOWER(nombre) = LOWER($1)
      LIMIT 1
    `,
    [specialtyName.trim()],
  );

  return rows[0]?.id_especialidad || null;
};

app.get('/api/health', async (_req, res, next) => {
  try {
    await testConnection();
    res.json({ ok: true, db: 'connected' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/specialties', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT 
          id_especialidad as id, 
          nombre as name,
          descripcion as description,
          estado as status
        FROM especialidades
        WHERE
          $1 = ''
          OR nombre ILIKE '%' || $1 || '%'
        ORDER BY id_especialidad ASC
      `,
      [search]
    );

    res.json({ specialties: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/specialties/:id', async (req, res, next) => {
  try {
    const specialtyId = Number(req.params.id);

    if (!Number.isInteger(specialtyId) || specialtyId <= 0) {
      return res.status(400).json({ error: 'ID de especialidad invalido.' });
    }

    const { rows } = await query(
      `
        SELECT 
          id_especialidad as id, 
          nombre as name,
          descripcion as description,
          estado as status
        FROM especialidades
        WHERE id_especialidad = $1
        LIMIT 1
      `,
      [specialtyId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Especialidad no encontrada.' });
    }

    return res.json({ specialty: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/specialties', async (req, res, next) => {
  try {
    const { name, description, status } = req.body || {};

    if (!name || name.trim() === '') {
      return res.status(400).json({
        error: 'El nombre es obligatorio.',
      });
    }

    const insertResult = await query(
      `
        INSERT INTO especialidades (
          nombre,
          descripcion,
          estado
        )
        VALUES ($1, $2, $3)
        RETURNING id_especialidad as id, nombre as name, descripcion as description, estado as status
      `,
      [name.trim(), description || '', toDbStatus(status)],
    );

    return res.status(201).json({ specialty: insertResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put('/api/specialties/:id', async (req, res, next) => {
  try {
    const specialtyId = Number(req.params.id);

    if (!Number.isInteger(specialtyId) || specialtyId <= 0) {
      return res.status(400).json({ error: 'ID de especialidad invalido.' });
    }

    const { name, description, status } = req.body || {};

    if (!name || name.trim() === '') {
      return res.status(400).json({
        error: 'El nombre es obligatorio.',
      });
    }

    const updateResult = await query(
      `
        UPDATE especialidades
        SET
          nombre = $2,
          descripcion = $3,
          estado = $4
        WHERE id_especialidad = $1
        RETURNING id_especialidad as id, nombre as name, descripcion as description, estado as status
      `,
      [specialtyId, name.trim(), description || '', toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Especialidad no encontrada.' });
    }

    return res.json({ specialty: updateResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/specialties/:id/status', async (req, res, next) => {
  try {
    const specialtyId = Number(req.params.id);

    if (!Number.isInteger(specialtyId) || specialtyId <= 0) {
      return res.status(400).json({ error: 'ID de especialidad invalido.' });
    }

    const { status } = req.body || {};

    const updateResult = await query(
      `
        UPDATE especialidades
        SET estado = $2
        WHERE id_especialidad = $1
        RETURNING id_especialidad as id, nombre as name, descripcion as description, estado as status
      `,
      [specialtyId, toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Especialidad no encontrada.' });
    }

    return res.json({ specialty: updateResult.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/specialties/:id', async (req, res, next) => {
  try {
    const specialtyId = Number(req.params.id);

    if (!Number.isInteger(specialtyId) || specialtyId <= 0) {
      return res.status(400).json({ error: 'ID de especialidad invalido.' });
    }

    const { rows } = await query(
      `
        SELECT 
          id_especialidad as id, 
          nombre as name,
          descripcion as description,
          estado as status
        FROM especialidades
        WHERE id_especialidad = $1
        LIMIT 1
      `,
      [specialtyId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Especialidad no encontrada.' });
    }

    await query(
      `DELETE FROM especialidades WHERE id_especialidad = $1`,
      [specialtyId],
    );

    return res.json({ specialty: rows[0] });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar la especialidad porque tiene servicios asociados. Desactívela en su lugar.' });
    }
    next(error);
  }
});

// --- PATIENTS ---
app.get('/api/patients', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT 
          id_paciente as id,
          dni,
          nombre_completo as name,
          sexo as gender,
          fecha_nacimiento as "birthDate",
          celular as phone,
          correo as email,
          direccion as address,
          emergencia_1 as "emergencyContact1",
          emergencia_2 as "emergencyContact2",
          password
        FROM pacientes
        WHERE
          $1 = ''
          OR dni ILIKE '%' || $1 || '%'
          OR nombre_completo ILIKE '%' || $1 || '%'
        ORDER BY id_paciente ASC
      `,
      [search]
    );

    res.json({ patients: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/patients/:id', async (req, res, next) => {
  try {
    const patientId = Number(req.params.id);

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'ID de paciente invalido.' });
    }

    const { rows } = await query(
      `
        SELECT 
          id_paciente as id,
          dni,
          nombre_completo as name,
          sexo as gender,
          fecha_nacimiento as "birthDate",
          celular as phone,
          correo as email,
          direccion as address,
          emergencia_1 as "emergencyContact1",
          emergencia_2 as "emergencyContact2",
          password
        FROM pacientes
        WHERE id_paciente = $1
        LIMIT 1
      `,
      [patientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado.' });
    }

    return res.json({ patient: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/patients', async (req, res, next) => {
  try {
    const { dni, name, gender, birthDate, phone, email, address, emergencyContact1, emergencyContact2, password } = req.body || {};

    if (!dni || !name || !dni.trim() || !name.trim()) {
      return res.status(400).json({
        error: 'El DNI y Nombre Completo son obligatorios.',
      });
    }

    const insertResult = await query(
      `
        INSERT INTO pacientes (
          dni,
          nombre_completo,
          sexo,
          fecha_nacimiento,
          celular,
          correo,
          direccion,
          emergencia_1,
          emergencia_2,
          password
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING 
          id_paciente as id,
          dni,
          nombre_completo as name,
          sexo as gender,
          fecha_nacimiento as "birthDate",
          celular as phone,
          correo as email,
          direccion as address,
          emergencia_1 as "emergencyContact1",
          emergencia_2 as "emergencyContact2",
          password
      `,
      [
        dni.trim(), 
        name.trim(), 
        gender || null, 
        birthDate || null, 
        phone || null, 
        email || null, 
        address || null, 
        emergencyContact1 || null, 
        emergencyContact2 || null, 
        password || null
      ]
    );

    return res.status(201).json({ patient: insertResult.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un paciente con ese DNI.' });
    }
    next(error);
  }
});

app.put('/api/patients/:id', async (req, res, next) => {
  try {
    const patientId = Number(req.params.id);

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'ID de paciente invalido.' });
    }

    const { dni, name, gender, birthDate, phone, email, address, emergencyContact1, emergencyContact2, password } = req.body || {};

    if (!dni || !name || !dni.trim() || !name.trim()) {
      return res.status(400).json({
        error: 'El DNI y Nombre Completo son obligatorios.',
      });
    }

    const updateResult = await query(
      `
        UPDATE pacientes
        SET
          dni = $2,
          nombre_completo = $3,
          sexo = $4,
          fecha_nacimiento = $5,
          celular = $6,
          correo = $7,
          direccion = $8,
          emergencia_1 = $9,
          emergencia_2 = $10,
          password = $11
        WHERE id_paciente = $1
        RETURNING 
          id_paciente as id,
          dni,
          nombre_completo as name,
          sexo as gender,
          fecha_nacimiento as "birthDate",
          celular as phone,
          correo as email,
          direccion as address,
          emergencia_1 as "emergencyContact1",
          emergencia_2 as "emergencyContact2",
          password
      `,
      [
        patientId, 
        dni.trim(), 
        name.trim(), 
        gender || null, 
        birthDate || null, 
        phone || null, 
        email || null, 
        address || null, 
        emergencyContact1 || null, 
        emergencyContact2 || null, 
        password || null
      ]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado.' });
    }

    return res.json({ patient: updateResult.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un paciente con ese DNI.' });
    }
    next(error);
  }
});

app.delete('/api/patients/:id', async (req, res, next) => {
  try {
    const patientId = Number(req.params.id);

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'ID de paciente invalido.' });
    }

    const { rows } = await query(
      `
        SELECT id_paciente 
        FROM pacientes
        WHERE id_paciente = $1
        LIMIT 1
      `,
      [patientId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado.' });
    }

    await query(
      `DELETE FROM pacientes WHERE id_paciente = $1`,
      [patientId],
    );

    return res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar el paciente porque tiene registros asociados (ej. citas o historial médico).' });
    }
    next(error);
  }
});

// --- STAFF ---
app.get('/api/staff', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT 
          p.id_trabajador as id,
          p.dni,
          p.nombre_completo as name,
          p.id_especialidad as "specialtyId",
          e.nombre as "specialtyName",
          p.estado as status,
          p.celular as phone,
          p.correo as email,
          p.direccion as address,
          p.salario as salary,
          p.rol as "userRole",
          p.password
        FROM personal p
        LEFT JOIN especialidades e ON p.id_especialidad = e.id_especialidad
        WHERE
          $1 = ''
          OR p.dni ILIKE '%' || $1 || '%'
          OR p.nombre_completo ILIKE '%' || $1 || '%'
        ORDER BY p.id_trabajador ASC
      `,
      [search]
    );

    res.json({ staff: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/:id', async (req, res, next) => {
  try {
    const staffId = Number(req.params.id);

    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'ID de personal invalido.' });
    }

    const { rows } = await query(
      `
        SELECT 
          p.id_trabajador as id,
          p.dni,
          p.nombre_completo as name,
          p.id_especialidad as "specialtyId",
          e.nombre as "specialtyName",
          p.estado as status,
          p.celular as phone,
          p.correo as email,
          p.direccion as address,
          p.salario as salary,
          p.rol as "userRole",
          p.password
        FROM personal p
        LEFT JOIN especialidades e ON p.id_especialidad = e.id_especialidad
        WHERE p.id_trabajador = $1
        LIMIT 1
      `,
      [staffId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Personal no encontrado.' });
    }

    return res.json({ staff: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff', async (req, res, next) => {
  try {
    const { dni, name, specialtyId, status, phone, email, address, salary, userRole, password } = req.body || {};

    if (!dni || !name || !dni.trim() || !name.trim()) {
      return res.status(400).json({
        error: 'El DNI y Nombre Completo son obligatorios.',
      });
    }

    const insertResult = await query(
      `
        INSERT INTO personal (
          dni,
          nombre_completo,
          id_especialidad,
          estado,
          celular,
          correo,
          direccion,
          salario,
          rol,
          password
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING 
          id_trabajador as id
      `,
      [
        dni.trim(), 
        name.trim(), 
        specialtyId || null, 
        status || 'ACTIVO', 
        phone || null, 
        email || null, 
        address || null, 
        salary || null, 
        userRole || 'EMPLEADO', 
        password || null
      ]
    );

    // Fetch the inserted record with join
    const { rows } = await query(
      `
        SELECT 
          p.id_trabajador as id,
          p.dni,
          p.nombre_completo as name,
          p.id_especialidad as "specialtyId",
          e.nombre as "specialtyName",
          p.estado as status,
          p.celular as phone,
          p.correo as email,
          p.direccion as address,
          p.salario as salary,
          p.rol as "userRole",
          p.password
        FROM personal p
        LEFT JOIN especialidades e ON p.id_especialidad = e.id_especialidad
        WHERE p.id_trabajador = $1
      `,
      [insertResult.rows[0].id]
    );

    return res.status(201).json({ staff: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un trabajador con ese DNI.' });
    }
    next(error);
  }
});

app.put('/api/staff/:id', async (req, res, next) => {
  try {
    const staffId = Number(req.params.id);

    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'ID de personal invalido.' });
    }

    const { dni, name, specialtyId, status, phone, email, address, salary, userRole, password } = req.body || {};

    if (!dni || !name || !dni.trim() || !name.trim()) {
      return res.status(400).json({
        error: 'El DNI y Nombre Completo son obligatorios.',
      });
    }

    const updateResult = await query(
      `
        UPDATE personal
        SET
          dni = $2,
          nombre_completo = $3,
          id_especialidad = $4,
          estado = $5,
          celular = $6,
          correo = $7,
          direccion = $8,
          salario = $9,
          rol = $10,
          password = $11
        WHERE id_trabajador = $1
        RETURNING id_trabajador as id
      `,
      [
        staffId, 
        dni.trim(), 
        name.trim(), 
        specialtyId || null, 
        status || 'ACTIVO', 
        phone || null, 
        email || null, 
        address || null, 
        salary || null, 
        userRole || 'EMPLEADO', 
        password || null
      ]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Personal no encontrado.' });
    }

    // Fetch the updated record with join
    const { rows } = await query(
      `
        SELECT 
          p.id_trabajador as id,
          p.dni,
          p.nombre_completo as name,
          p.id_especialidad as "specialtyId",
          e.nombre as "specialtyName",
          p.estado as status,
          p.celular as phone,
          p.correo as email,
          p.direccion as address,
          p.salario as salary,
          p.rol as "userRole",
          p.password
        FROM personal p
        LEFT JOIN especialidades e ON p.id_especialidad = e.id_especialidad
        WHERE p.id_trabajador = $1
      `,
      [staffId]
    );

    return res.json({ staff: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un trabajador con ese DNI.' });
    }
    next(error);
  }
});

app.delete('/api/staff/:id', async (req, res, next) => {
  try {
    const staffId = Number(req.params.id);

    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({ error: 'ID de personal invalido.' });
    }

    const { rows } = await query(
      `
        SELECT id_trabajador 
        FROM personal
        WHERE id_trabajador = $1
        LIMIT 1
      `,
      [staffId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Personal no encontrado.' });
    }

    await query(
      `DELETE FROM personal WHERE id_trabajador = $1`,
      [staffId],
    );

    return res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar al trabajador porque tiene registros asociados.' });
    }
    next(error);
  }
});

// --- APPOINTMENTS (CITAS) ---
app.get('/api/appointments', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT 
          c.id_cita as id,
          c.id_paciente as "patientId",
          p.dni as "patientDni",
          p.nombre_completo as "patientName",
          c.id_servicio as "serviceId",
          s.nombre as "serviceName",
          s.tipo as "serviceType",
          s.precio as "servicePrice",
          c.estado as status,
          c.fecha_cita as "dateTime"
        FROM citas c
        INNER JOIN pacientes p ON c.id_paciente = p.id_paciente
        INNER JOIN servicios s ON c.id_servicio = s.id_servicio
        WHERE
          $1 = ''
          OR p.dni ILIKE '%' || $1 || '%'
          OR p.nombre_completo ILIKE '%' || $1 || '%'
          OR s.nombre ILIKE '%' || $1 || '%'
        ORDER BY c.fecha_cita DESC, c.id_cita DESC
      `,
      [search]
    );

    res.json({ appointments: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/appointments/:id', async (req, res, next) => {
  try {
    const appointmentId = Number(req.params.id);

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).json({ error: 'ID de cita invalido.' });
    }

    const { rows } = await query(
      `
        SELECT 
          c.id_cita as id,
          c.id_paciente as "patientId",
          p.dni as "patientDni",
          p.nombre_completo as "patientName",
          c.id_servicio as "serviceId",
          s.nombre as "serviceName",
          s.tipo as "serviceType",
          s.precio as "servicePrice",
          c.estado as status,
          c.fecha_cita as "dateTime"
        FROM citas c
        INNER JOIN pacientes p ON c.id_paciente = p.id_paciente
        INNER JOIN servicios s ON c.id_servicio = s.id_servicio
        WHERE c.id_cita = $1
        LIMIT 1
      `,
      [appointmentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada.' });
    }

    return res.json({ appointment: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/appointments', async (req, res, next) => {
  try {
    const { patientId, serviceId, status, dateTime } = req.body || {};

    if (!patientId || !serviceId || !dateTime) {
      return res.status(400).json({
        error: 'ID de paciente, ID de servicio y fecha son obligatorios.',
      });
    }

    const insertResult = await query(
      `
        INSERT INTO citas (
          id_paciente,
          id_servicio,
          estado,
          fecha_cita
        )
        VALUES ($1, $2, $3, $4)
        RETURNING 
          id_cita as id
      `,
      [
        patientId, 
        serviceId, 
        status || 'EN ESPERA', 
        dateTime
      ]
    );

    // Fetch the inserted record with join
    const { rows } = await query(
      `
        SELECT 
          c.id_cita as id,
          c.id_paciente as "patientId",
          p.dni as "patientDni",
          p.nombre_completo as "patientName",
          c.id_servicio as "serviceId",
          s.nombre as "serviceName",
          s.tipo as "serviceType",
          s.precio as "servicePrice",
          c.estado as status,
          c.fecha_cita as "dateTime"
        FROM citas c
        INNER JOIN pacientes p ON c.id_paciente = p.id_paciente
        INNER JOIN servicios s ON c.id_servicio = s.id_servicio
        WHERE c.id_cita = $1
      `,
      [insertResult.rows[0].id]
    );

    return res.status(201).json({ appointment: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put('/api/appointments/:id', async (req, res, next) => {
  try {
    const appointmentId = Number(req.params.id);

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).json({ error: 'ID de cita invalido.' });
    }

    const { patientId, serviceId, status, dateTime } = req.body || {};

    if (!patientId || !serviceId || !dateTime) {
      return res.status(400).json({
        error: 'ID de paciente, ID de servicio y fecha son obligatorios.',
      });
    }

    const updateResult = await query(
      `
        UPDATE citas
        SET
          id_paciente = $2,
          id_servicio = $3,
          estado = $4,
          fecha_cita = $5
        WHERE id_cita = $1
        RETURNING id_cita as id
      `,
      [
        appointmentId, 
        patientId, 
        serviceId, 
        status || 'EN ESPERA', 
        dateTime
      ]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Cita no encontrada.' });
    }

    // Fetch the updated record with join
    const { rows } = await query(
      `
        SELECT 
          c.id_cita as id,
          c.id_paciente as "patientId",
          p.dni as "patientDni",
          p.nombre_completo as "patientName",
          c.id_servicio as "serviceId",
          s.nombre as "serviceName",
          s.tipo as "serviceType",
          s.precio as "servicePrice",
          c.estado as status,
          c.fecha_cita as "dateTime"
        FROM citas c
        INNER JOIN pacientes p ON c.id_paciente = p.id_paciente
        INNER JOIN servicios s ON c.id_servicio = s.id_servicio
        WHERE c.id_cita = $1
      `,
      [appointmentId]
    );

    return res.json({ appointment: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/appointments/:id', async (req, res, next) => {
  try {
    const appointmentId = Number(req.params.id);

    if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
      return res.status(400).json({ error: 'ID de cita invalido.' });
    }

    const { rows } = await query(
      `
        SELECT id_cita 
        FROM citas
        WHERE id_cita = $1
        LIMIT 1
      `,
      [appointmentId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada.' });
    }

    await query(
      `DELETE FROM citas WHERE id_cita = $1`,
      [appointmentId],
    );

    return res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'No se puede eliminar la cita porque tiene registros asociados.' });
    }
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { dni, password } = req.body || {};

    if (!dni || !password) {
      return res.status(400).json({ error: 'DNI y password son obligatorios.' });
    }

    const { rows } = await query(
      `
        SELECT
          id_trabajador,
          dni,
          nombre_completo,
          celular,
          correo,
          direccion,
          password,
          rol,
          estado
        FROM personal
        WHERE dni = $1
        LIMIT 1
      `,
      [dni],
    );

    const worker = rows[0];

    if (!worker || worker.password !== password) {
      return res.status(401).json({ error: 'DNI o password incorrectos.' });
    }

    if (String(worker.estado).toUpperCase() !== 'ACTIVO') {
      return res.status(403).json({ error: 'El usuario esta inactivo.' });
    }

    return res.json({
      user: {
        workerId: worker.id_trabajador,
        dni: worker.dni,
        name: worker.nombre_completo,
        phone: worker.celular || '',
        email: worker.correo || '',
        address: worker.direccion || '',
        role: worker.rol || 'EMPLEADO',
        // Kept for compatibility with the current profile screen behavior.
        password: worker.password,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/client-login', async (req, res, next) => {
  try {
    const { dni, password } = req.body || {};

    if (!dni || !password) {
      return res.status(400).json({ error: 'DNI y password son obligatorios.' });
    }

    const { rows } = await query(
      `
        SELECT
          id_paciente,
          dni,
          nombre_completo,
          celular,
          correo,
          direccion,
          password,
          emergencia_1,
          emergencia_2
        FROM pacientes
        WHERE dni = $1
        LIMIT 1
      `,
      [dni],
    );

    const patient = rows[0];

    if (!patient || patient.password !== password) {
      return res.status(401).json({ error: 'DNI o password incorrectos.' });
    }

    return res.json({
      user: {
        workerId: patient.id_paciente, // Map to workerId to keep compatibility with AuthUser format
        dni: patient.dni,
        name: patient.nombre_completo,
        phone: patient.celular || '',
        email: patient.correo || '',
        address: patient.direccion || '',
        emergencyContact1: patient.emergencia_1 || '',
        emergencyContact2: patient.emergencia_2 || '',
        role: 'CLIENTE',
        password: patient.password,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/client-profile/:id', async (req, res, next) => {
  try {
    const patientId = Number(req.params.id);

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'ID de paciente invalido.' });
    }

    const { phone, email, address, emergencyContact1, emergencyContact2 } = req.body || {};

    await query(
      `
        UPDATE pacientes
        SET 
          celular = $1,
          correo = $2,
          direccion = $3,
          emergencia_1 = $4,
          emergencia_2 = $5
        WHERE id_paciente = $6
      `,
      [phone, email, address, emergencyContact1, emergencyContact2, patientId],
    );

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.put('/api/client-profile/:id/password', async (req, res, next) => {
  try {
    const patientId = Number(req.params.id);

    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'ID de paciente invalido.' });
    }

    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Faltan campos de contraseña.' });
    }

    const { rows } = await query(
      'SELECT password FROM pacientes WHERE id_paciente = $1 LIMIT 1',
      [patientId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado.' });
    }

    if (rows[0].password !== currentPassword) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
    }

    await query(
      'UPDATE pacientes SET password = $1 WHERE id_paciente = $2',
      [newPassword, patientId],
    );

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.put('/api/profile/:id', async (req, res, next) => {
  try {
    const workerId = Number(req.params.id);

    if (!Number.isInteger(workerId) || workerId <= 0) {
      return res.status(400).json({ error: 'ID de personal invalido.' });
    }

    const { phone, email, address } = req.body || {};

    const updateResult = await query(
      `
        UPDATE personal
        SET
          celular = $2,
          correo = $3,
          direccion = $4
        WHERE id_trabajador = $1
        RETURNING id_trabajador
      `,
      [workerId, phone || null, email || null, address || null]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.put('/api/profile/:id/password', async (req, res, next) => {
  try {
    const workerId = Number(req.params.id);

    if (!Number.isInteger(workerId) || workerId <= 0) {
      return res.status(400).json({ error: 'ID de personal invalido.' });
    }

    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Las contraseñas son obligatorias.' });
    }

    const { rows } = await query(
      `SELECT password FROM personal WHERE id_trabajador = $1 LIMIT 1`,
      [workerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    if (rows[0].password !== currentPassword) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
    }

    await query(
      `UPDATE personal SET password = $2 WHERE id_trabajador = $1`,
      [workerId, newPassword]
    );

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard-stats', async (req, res, next) => {
  try {
    // 1. Número de citas al mes
    const citasMesRes = await query(`
      SELECT COUNT(*)::int as count 
      FROM citas 
      WHERE date_trunc('month', fecha_cita) = date_trunc('month', CURRENT_DATE)
    `);
    const citasMes = citasMesRes.rows[0]?.count || 0;

    // 2. Ingresos totales hoy
    const ingresosHoyRes = await query(`
      SELECT SUM(s.precio::numeric) as sum
      FROM citas c
      JOIN servicios s ON c.id_servicio = s.id_servicio
      WHERE date_trunc('day', c.fecha_cita) = date_trunc('day', CURRENT_DATE)
    `);
    const ingresosHoy = Number(ingresosHoyRes.rows[0]?.sum) || 0;

    // 3. Ingresos totales del mes
    const ingresosMesRes = await query(`
      SELECT SUM(s.precio::numeric) as sum
      FROM citas c
      JOIN servicios s ON c.id_servicio = s.id_servicio
      WHERE date_trunc('month', c.fecha_cita) = date_trunc('month', CURRENT_DATE)
    `);
    const ingresosMes = Number(ingresosMesRes.rows[0]?.sum) || 0;

    // 4. Gastos totales mensuales (salarios personal activo)
    const gastosMesRes = await query(`
      SELECT SUM(salario::numeric) as sum 
      FROM personal 
      WHERE estado = 'ACTIVO'
    `);
    const gastosMes = Number(gastosMesRes.rows[0]?.sum) || 0;

    // 5. Pacientes en espera
    const enEsperaRes = await query(`
      SELECT COUNT(*)::int as count 
      FROM citas 
      WHERE estado = 'EN ESPERA'
    `);
    const enEspera = enEsperaRes.rows[0]?.count || 0;

    // 6. Citas completadas al mes
    const completadasMesRes = await query(`
      SELECT COUNT(*)::int as count 
      FROM citas 
      WHERE estado = 'COMPLETADA' AND date_trunc('month', fecha_cita) = date_trunc('month', CURRENT_DATE)
    `);
    const completadasMes = completadasMesRes.rows[0]?.count || 0;

    // 7. Servicios mas solicitados del mes
    const topServicesRes = await query(`
      SELECT s.nombre as name, COUNT(*)::int as value
      FROM citas c
      JOIN servicios s ON c.id_servicio = s.id_servicio
      WHERE date_trunc('month', c.fecha_cita) = date_trunc('month', CURRENT_DATE)
      GROUP BY s.nombre
      ORDER BY value DESC
      LIMIT 10
    `);
    const topServices = topServicesRes.rows;

    res.json({
      citasMes,
      ingresosHoy,
      ingresosMes,
      gastosMes,
      enEspera,
      completadasMes,
      topServices,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/appointment-rates', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT
          s.id_servicio,
          s.codigo_display,
          s.nombre,
          s.tipo,
          s.precio,
          s.descripcion,
          s.estado,
          s.id_especialidad,
          e.nombre AS especialidad
        FROM servicios s
        INNER JOIN especialidades e ON e.id_especialidad = s.id_especialidad
        WHERE s.tipo = 'CONSULTA'
          AND (
            $1 = ''
            OR s.nombre ILIKE '%' || $1 || '%'
            OR e.nombre ILIKE '%' || $1 || '%'
          )
        ORDER BY s.id_servicio ASC
      `,
      [search],
    );

    res.json({ rates: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/appointment-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const rate = await getRateById(serviceId);

    if (!rate) {
      return res.status(404).json({ error: 'Tarifa no encontrada.' });
    }

    return res.json({ rate });
  } catch (error) {
    next(error);
  }
});

app.post('/api/appointment-rates', async (req, res, next) => {
  try {
    const { name, specialty, price, description, status } = req.body || {};

    if (!name || !specialty || price === undefined || price === null) {
      return res.status(400).json({
        error: 'Nombre, especialidad y precio son obligatorios.',
      });
    }

    const specialtyId = await getSpecialtyIdByName(specialty);

    if (!specialtyId) {
      return res.status(400).json({ error: 'La especialidad no existe.' });
    }

    const parsedPrice = parsePrice(price);

    const insertResult = await query(
      `
        INSERT INTO servicios (
          nombre,
          tipo,
          id_especialidad,
          precio,
          descripcion,
          estado
        )
        VALUES ($1, 'CONSULTA', $2, $3, $4, $5)
        RETURNING id_servicio
      `,
      [name.trim(), specialtyId, parsedPrice, description || '', toDbStatus(status)],
    );

    const newRate = await getRateById(insertResult.rows[0].id_servicio);

    return res.status(201).json({ rate: newRate });
  } catch (error) {
    next(error);
  }
});

app.put('/api/appointment-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const { name, specialty, price, description, status } = req.body || {};

    if (!name || !specialty || price === undefined || price === null) {
      return res.status(400).json({
        error: 'Nombre, especialidad y precio son obligatorios.',
      });
    }

    const specialtyId = await getSpecialtyIdByName(specialty);

    if (!specialtyId) {
      return res.status(400).json({ error: 'La especialidad no existe.' });
    }

    const parsedPrice = parsePrice(price);

    const updateResult = await query(
      `
        UPDATE servicios
        SET
          nombre = $2,
          id_especialidad = $3,
          precio = $4,
          descripcion = $5,
          estado = $6
        WHERE id_servicio = $1 AND tipo = 'CONSULTA'
        RETURNING id_servicio
      `,
      [serviceId, name.trim(), specialtyId, parsedPrice, description || '', toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tarifa no encontrada.' });
    }

    const updatedRate = await getRateById(serviceId);
    return res.json({ rate: updatedRate });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/appointment-rates/:id/status', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const { status } = req.body || {};

    const updateResult = await query(
      `
        UPDATE servicios
        SET estado = $2
        WHERE id_servicio = $1 AND tipo = 'CONSULTA'
        RETURNING id_servicio
      `,
      [serviceId, toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tarifa no encontrada.' });
    }

    const updatedRate = await getRateById(serviceId);
    return res.json({ rate: updatedRate });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/appointment-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const deletedRate = await getRateById(serviceId);
    
    if (!deletedRate) {
      return res.status(404).json({ error: 'Tarifa no encontrada.' });
    }

    await query(
      `DELETE FROM servicios WHERE id_servicio = $1 AND tipo = 'CONSULTA'`,
      [serviceId],
    );

    return res.json({ rate: deletedRate });
  } catch (error) {
    next(error);
  }
});

// --- EXAM RATES ENDPOINTS ---

app.get('/api/exam-rates', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT
          s.id_servicio,
          s.codigo_display,
          s.nombre,
          s.tipo,
          s.precio,
          s.descripcion,
          s.estado,
          s.id_especialidad,
          e.nombre AS especialidad
        FROM servicios s
        INNER JOIN especialidades e ON e.id_especialidad = s.id_especialidad
        WHERE s.tipo = 'EXAMEN'
          AND (
            $1 = ''
            OR s.nombre ILIKE '%' || $1 || '%'
            OR e.nombre ILIKE '%' || $1 || '%'
          )
        ORDER BY s.id_servicio ASC
      `,
      [search],
    );

    res.json({ rates: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/exam-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const rate = await getRateById(serviceId, 'EXAMEN');

    if (!rate) {
      return res.status(404).json({ error: 'Examen no encontrado.' });
    }

    return res.json({ rate });
  } catch (error) {
    next(error);
  }
});

app.post('/api/exam-rates', async (req, res, next) => {
  try {
    const { name, specialty, price, description, status } = req.body || {};

    if (!name || !specialty || price === undefined || price === null) {
      return res.status(400).json({
        error: 'Nombre, especialidad y precio son obligatorios.',
      });
    }

    const specialtyId = await getSpecialtyIdByName(specialty);

    if (!specialtyId) {
      return res.status(400).json({ error: 'La especialidad no existe.' });
    }

    const parsedPrice = parsePrice(price);

    const insertResult = await query(
      `
        INSERT INTO servicios (
          nombre,
          tipo,
          id_especialidad,
          precio,
          descripcion,
          estado
        )
        VALUES ($1, 'EXAMEN', $2, $3, $4, $5)
        RETURNING id_servicio
      `,
      [name.trim(), specialtyId, parsedPrice, description || '', toDbStatus(status)],
    );

    const newRate = await getRateById(insertResult.rows[0].id_servicio, 'EXAMEN');

    return res.status(201).json({ rate: newRate });
  } catch (error) {
    next(error);
  }
});

app.put('/api/exam-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const { name, specialty, price, description, status } = req.body || {};

    if (!name || !specialty || price === undefined || price === null) {
      return res.status(400).json({
        error: 'Nombre, especialidad y precio son obligatorios.',
      });
    }

    const specialtyId = await getSpecialtyIdByName(specialty);

    if (!specialtyId) {
      return res.status(400).json({ error: 'La especialidad no existe.' });
    }

    const parsedPrice = parsePrice(price);

    const updateResult = await query(
      `
        UPDATE servicios
        SET
          nombre = $2,
          id_especialidad = $3,
          precio = $4,
          descripcion = $5,
          estado = $6
        WHERE id_servicio = $1 AND tipo = 'EXAMEN'
        RETURNING id_servicio
      `,
      [serviceId, name.trim(), specialtyId, parsedPrice, description || '', toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Examen no encontrado.' });
    }

    const updatedRate = await getRateById(serviceId, 'EXAMEN');
    return res.json({ rate: updatedRate });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/exam-rates/:id/status', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const { status } = req.body || {};

    const updateResult = await query(
      `
        UPDATE servicios
        SET estado = $2
        WHERE id_servicio = $1 AND tipo = 'EXAMEN'
        RETURNING id_servicio
      `,
      [serviceId, toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Examen no encontrado.' });
    }

    const updatedRate = await getRateById(serviceId, 'EXAMEN');
    return res.json({ rate: updatedRate });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/exam-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const deletedRate = await getRateById(serviceId, 'EXAMEN');
    
    if (!deletedRate) {
      return res.status(404).json({ error: 'Examen no encontrado.' });
    }

    await query(
      `DELETE FROM servicios WHERE id_servicio = $1 AND tipo = 'EXAMEN'`,
      [serviceId],
    );

    return res.json({ rate: deletedRate });
  } catch (error) {
    next(error);
  }
});

// --- PROCEDURE RATES ENDPOINTS ---

app.get('/api/procedure-rates', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT
          s.id_servicio,
          s.codigo_display,
          s.nombre,
          s.tipo,
          s.precio,
          s.descripcion,
          s.estado,
          s.id_especialidad,
          e.nombre AS especialidad
        FROM servicios s
        INNER JOIN especialidades e ON e.id_especialidad = s.id_especialidad
        WHERE s.tipo = 'PROCEDIMIENTO'
          AND (
            $1 = ''
            OR s.nombre ILIKE '%' || $1 || '%'
            OR e.nombre ILIKE '%' || $1 || '%'
          )
        ORDER BY s.id_servicio ASC
      `,
      [search],
    );

    res.json({ rates: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/procedure-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const rate = await getRateById(serviceId, 'PROCEDIMIENTO');

    if (!rate) {
      return res.status(404).json({ error: 'Procedimiento no encontrado.' });
    }

    return res.json({ rate });
  } catch (error) {
    next(error);
  }
});

app.post('/api/procedure-rates', async (req, res, next) => {
  try {
    const { name, specialty, price, description, status } = req.body || {};

    if (!name || !specialty || price === undefined || price === null) {
      return res.status(400).json({
        error: 'Nombre, especialidad y precio son obligatorios.',
      });
    }

    const specialtyId = await getSpecialtyIdByName(specialty);

    if (!specialtyId) {
      return res.status(400).json({ error: 'La especialidad no existe.' });
    }

    const parsedPrice = parsePrice(price);

    const insertResult = await query(
      `
        INSERT INTO servicios (
          nombre,
          tipo,
          id_especialidad,
          precio,
          descripcion,
          estado
        )
        VALUES ($1, 'PROCEDIMIENTO', $2, $3, $4, $5)
        RETURNING id_servicio
      `,
      [name.trim(), specialtyId, parsedPrice, description || '', toDbStatus(status)],
    );

    const newRate = await getRateById(insertResult.rows[0].id_servicio, 'PROCEDIMIENTO');

    return res.status(201).json({ rate: newRate });
  } catch (error) {
    next(error);
  }
});

app.put('/api/procedure-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const { name, specialty, price, description, status } = req.body || {};

    if (!name || !specialty || price === undefined || price === null) {
      return res.status(400).json({
        error: 'Nombre, especialidad y precio son obligatorios.',
      });
    }

    const specialtyId = await getSpecialtyIdByName(specialty);

    if (!specialtyId) {
      return res.status(400).json({ error: 'La especialidad no existe.' });
    }

    const parsedPrice = parsePrice(price);

    const updateResult = await query(
      `
        UPDATE servicios
        SET
          nombre = $2,
          id_especialidad = $3,
          precio = $4,
          descripcion = $5,
          estado = $6
        WHERE id_servicio = $1 AND tipo = 'PROCEDIMIENTO'
        RETURNING id_servicio
      `,
      [serviceId, name.trim(), specialtyId, parsedPrice, description || '', toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Procedimiento no encontrado.' });
    }

    const updatedRate = await getRateById(serviceId, 'PROCEDIMIENTO');
    return res.json({ rate: updatedRate });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/procedure-rates/:id/status', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const { status } = req.body || {};

    const updateResult = await query(
      `
        UPDATE servicios
        SET estado = $2
        WHERE id_servicio = $1 AND tipo = 'PROCEDIMIENTO'
        RETURNING id_servicio
      `,
      [serviceId, toDbStatus(status)],
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Procedimiento no encontrado.' });
    }

    const updatedRate = await getRateById(serviceId, 'PROCEDIMIENTO');
    return res.json({ rate: updatedRate });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/procedure-rates/:id', async (req, res, next) => {
  try {
    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId) || serviceId <= 0) {
      return res.status(400).json({ error: 'ID de servicio invalido.' });
    }

    const deletedRate = await getRateById(serviceId, 'PROCEDIMIENTO');
    
    if (!deletedRate) {
      return res.status(404).json({ error: 'Procedimiento no encontrado.' });
    }

    await query(
      `DELETE FROM servicios WHERE id_servicio = $1 AND tipo = 'PROCEDIMIENTO'`,
      [serviceId],
    );

    return res.json({ rate: deletedRate });
  } catch (error) {
    next(error);
  }
});

// --- MEDICAL HISTORIES ---
app.get('/api/medical-histories', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();

    const { rows } = await query(
      `
        SELECT 
          h.id_historial as id,
          h.fecha as date,
          h.id_paciente as "patientId",
          pa.dni as "patientDni",
          pa.nombre_completo as "patientName",
          h.id_medico_encargado as "doctorId",
          pe.nombre_completo as "doctorName",
          h.peso as weight,
          h.altura as height,
          h.hallazgos as findings,
          h.diagnostico as diagnosis,
          h.tratamiento as treatment,
          h.medicamentos as medications,
          h.procedimientos as procedures
        FROM historial_clinico h
        INNER JOIN pacientes pa ON h.id_paciente = pa.id_paciente
        INNER JOIN personal pe ON h.id_medico_encargado = pe.id_trabajador
        WHERE
          $1 = ''
          OR pa.dni ILIKE '%' || $1 || '%'
          OR pa.nombre_completo ILIKE '%' || $1 || '%'
        ORDER BY h.fecha DESC, h.id_historial DESC
      `,
      [search]
    );

    res.json({ histories: rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/medical-histories', async (req, res, next) => {
  try {
    const { patientId, doctorId, weight, height, findings, diagnosis, treatment, medications, procedures } = req.body || {};

    if (!patientId || !doctorId) {
      return res.status(400).json({ error: 'El paciente y el médico son obligatorios.' });
    }

    const insertResult = await query(
      `
        INSERT INTO historial_clinico (
          fecha,
          id_paciente,
          id_medico_encargado,
          peso,
          altura,
          hallazgos,
          diagnostico,
          tratamiento,
          medicamentos,
          procedimientos
        )
        VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id_historial as id
      `,
      [
        patientId,
        doctorId,
        weight || null,
        height || null,
        findings || null,
        diagnosis || null,
        treatment || null,
        medications || null,
        procedures || null
      ]
    );

    const { rows } = await query(
      `
        SELECT 
          h.id_historial as id,
          h.fecha as date,
          h.id_paciente as "patientId",
          pa.dni as "patientDni",
          pa.nombre_completo as "patientName",
          h.id_medico_encargado as "doctorId",
          pe.nombre_completo as "doctorName",
          h.peso as weight,
          h.altura as height,
          h.hallazgos as findings,
          h.diagnostico as diagnosis,
          h.tratamiento as treatment,
          h.medicamentos as medications,
          h.procedimientos as procedures
        FROM historial_clinico h
        INNER JOIN pacientes pa ON h.id_paciente = pa.id_paciente
        INNER JOIN personal pe ON h.id_medico_encargado = pe.id_trabajador
        WHERE h.id_historial = $1
      `,
      [insertResult.rows[0].id]
    );

    return res.status(201).json({ history: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put('/api/medical-histories/:id', async (req, res, next) => {
  try {
    const historyId = Number(req.params.id);

    if (!Number.isInteger(historyId) || historyId <= 0) {
      return res.status(400).json({ error: 'ID de historial invalido.' });
    }

    const { patientId, doctorId, weight, height, findings, diagnosis, treatment, medications, procedures } = req.body || {};

    if (!patientId || !doctorId) {
      return res.status(400).json({ error: 'El paciente y el médico son obligatorios.' });
    }

    const updateResult = await query(
      `
        UPDATE historial_clinico
        SET
          id_paciente = $2,
          id_medico_encargado = $3,
          peso = $4,
          altura = $5,
          hallazgos = $6,
          diagnostico = $7,
          tratamiento = $8,
          medicamentos = $9,
          procedimientos = $10
        WHERE id_historial = $1
        RETURNING id_historial as id
      `,
      [
        historyId,
        patientId,
        doctorId,
        weight || null,
        height || null,
        findings || null,
        diagnosis || null,
        treatment || null,
        medications || null,
        procedures || null
      ]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Historial no encontrado.' });
    }

    const { rows } = await query(
      `
        SELECT 
          h.id_historial as id,
          h.fecha as date,
          h.id_paciente as "patientId",
          pa.dni as "patientDni",
          pa.nombre_completo as "patientName",
          h.id_medico_encargado as "doctorId",
          pe.nombre_completo as "doctorName",
          h.peso as weight,
          h.altura as height,
          h.hallazgos as findings,
          h.diagnostico as diagnosis,
          h.tratamiento as treatment,
          h.medicamentos as medications,
          h.procedimientos as procedures
        FROM historial_clinico h
        INNER JOIN pacientes pa ON h.id_paciente = pa.id_paciente
        INNER JOIN personal pe ON h.id_medico_encargado = pe.id_trabajador
        WHERE h.id_historial = $1
      `,
      [historyId]
    );

    return res.json({ history: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/medical-histories/:id', async (req, res, next) => {
  try {
    const historyId = Number(req.params.id);

    if (!Number.isInteger(historyId) || historyId <= 0) {
      return res.status(400).json({ error: 'ID de historial invalido.' });
    }

    const { rows } = await query(
      `SELECT id_historial FROM historial_clinico WHERE id_historial = $1 LIMIT 1`,
      [historyId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Historial no encontrado.' });
    }

    await query(`DELETE FROM historial_clinico WHERE id_historial = $1`, [historyId]);

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// --- WORK SCHEDULES ---

app.get('/api/work-schedules', async (req, res, next) => {
  try {
    const { rows } = await query(
      `
        SELECT 
          h.id_horario as id,
          h.id_especialidad as "specialtyId",
          e.nombre as "specialtyName",
          h.mes as month,
          h.anio as year,
          h.id_trabajador_manana as "morningWorkerId",
          pm.nombre_completo as "morningWorkerName",
          h.id_trabajador_tarde as "afternoonWorkerId",
          pt.nombre_completo as "afternoonWorkerName"
        FROM horarios_laborales h
        INNER JOIN especialidades e ON h.id_especialidad = e.id_especialidad
        LEFT JOIN personal pm ON h.id_trabajador_manana = pm.id_trabajador
        LEFT JOIN personal pt ON h.id_trabajador_tarde = pt.id_trabajador
        ORDER BY h.anio DESC, h.mes DESC, e.nombre ASC
      `
    );

    res.json({ schedules: rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/work-schedules', async (req, res, next) => {
  try {
    const { specialtyId, month, year, morningWorkerId, afternoonWorkerId } = req.body || {};

    if (!specialtyId || !month || !year) {
      return res.status(400).json({ error: 'La especialidad, el mes y el año son obligatorios.' });
    }

    const mId = morningWorkerId || null;
    const aId = afternoonWorkerId || null;

    const upsertResult = await query(
      `
        INSERT INTO horarios_laborales (
          id_especialidad,
          mes,
          anio,
          id_trabajador_manana,
          id_trabajador_tarde
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id_especialidad, mes, anio) 
        DO UPDATE SET 
          id_trabajador_manana = EXCLUDED.id_trabajador_manana,
          id_trabajador_tarde = EXCLUDED.id_trabajador_tarde
        RETURNING id_horario as id
      `,
      [specialtyId, month, year, mId, aId]
    );

    const { rows } = await query(
      `
        SELECT 
          h.id_horario as id,
          h.id_especialidad as "specialtyId",
          e.nombre as "specialtyName",
          h.mes as month,
          h.anio as year,
          h.id_trabajador_manana as "morningWorkerId",
          pm.nombre_completo as "morningWorkerName",
          h.id_trabajador_tarde as "afternoonWorkerId",
          pt.nombre_completo as "afternoonWorkerName"
        FROM horarios_laborales h
        INNER JOIN especialidades e ON h.id_especialidad = e.id_especialidad
        LEFT JOIN personal pm ON h.id_trabajador_manana = pm.id_trabajador
        LEFT JOIN personal pt ON h.id_trabajador_tarde = pt.id_trabajador
        WHERE h.id_horario = $1
      `,
      [upsertResult.rows[0].id]
    );

    return res.status(201).json({ schedule: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/work-schedules/:id', async (req, res, next) => {
  try {
    const scheduleId = Number(req.params.id);

    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ error: 'ID de horario invalido.' });
    }

    const { rows } = await query(
      `SELECT id_horario FROM horarios_laborales WHERE id_horario = $1 LIMIT 1`,
      [scheduleId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Horario no encontrado.' });
    }

    await query(`DELETE FROM horarios_laborales WHERE id_horario = $1`, [scheduleId]);

    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// --- STATIC FILE SERVING (Production / Railway) ---
const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback: any non-API route serves index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[api] Unhandled error:', error);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

const start = async () => {
  await testConnection();

  app.listen(apiPort, apiHost, () => {
    console.log(`[api] SIGHOS backend running at http://${apiHost}:${apiPort}`);
  });
};

start().catch((error) => {
  console.error('[api] Failed to start server:', error);
  process.exit(1);
});
