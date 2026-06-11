import fetch from 'node-fetch';

const BASE_URL = 'https://api.json.pe';
const TOKEN = process.env.JSONPE_API_TOKEN;

export async function consultarDNI(dni) {
  if (!dni || !/^\d{8}$/.test(dni)) {
    throw new Error('DNI invalido. Debe tener exactamente 8 digitos.');
  }

  const url = 'https://api.json.pe/api/dni';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dni })
  });

  if (!response.ok) {
    throw new Error(`Error al consultar DNI: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success || !result.data) {
    throw new Error(result.message || 'DNI no encontrado.');
  }

  const person = result.data;
  return {
    dni: person.numero,
    nombres: person.nombres,
    apellidoPaterno: person.apellido_paterno,
    apellidoMaterno: person.apellido_materno,
    nombreCompleto: person.nombre_completo,
    fechaNacimiento: null,
    sexo: null,
  };
}