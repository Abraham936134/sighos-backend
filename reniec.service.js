import fetch from 'node-fetch';

const BASE_URL = 'https://api.json.pe';
const TOKEN = process.env.JSONPE_API_TOKEN;

export async function consultarDNI(dni) {
  if (!dni || !/^\d{8}$/.test(dni)) {
    throw new Error('DNI invalido. Debe tener exactamente 8 digitos.');
  }

  const url = `${BASE_URL}/v2/reniec/dni?numero=${dni}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Error al consultar DNI: ${response.status}`);
  }

  const data = await response.json();
  return {
    dni: data.dni,
    nombres: data.nombre,
    apellidoPaterno: data.apellidoPaterno,
    apellidoMaterno: data.apellidoMaterno,
    nombreCompleto: `${data.nombre} ${data.apellidoPaterno} ${data.apellidoMaterno}`,
    fechaNacimiento: data.fechaNacimiento,
    sexo: data.sexo,
  };
}