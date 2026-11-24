// Datos de ejemplo de la planta (ficticios)
export const PRODUCTOS = [
  { sku: 'TAP-28-PP', descripcion: 'Tapa 28 mm', skuResina: 'RES01', molde: 'MD-101', nominal: 1250, tol: 25 },
  { sku: 'ASA-12-PP', descripcion: 'Asa 12 cm', skuResina: 'RES01', molde: 'MD-118', nominal: 900, tol: 20 },
  { sku: 'CONT-500-PE', descripcion: 'Contenedor 500 ml', skuResina: 'RES02', molde: 'MD-205', nominal: 2400, tol: 40 },
  { sku: 'TAP-38-PE', descripcion: 'Tapa 38 mm', skuResina: 'RES02', molde: 'MD-140', nominal: 1600, tol: 30 },
  { sku: 'CLIP-07-PA', descripcion: 'Clip 7 mm', skuResina: 'RES03', molde: 'MD-310', nominal: 600, tol: 12 },
];

export const PROVEEDORES = ['PROV-ALFA', 'PROV-BETA', 'PROV-GAMA'];

// Personal (prefijo por rol)
export const PERSONAL = {
  almacenMP: ['A301', 'A302'],
  resina: ['R201', 'R202', 'R203'],
  supervisores: ['S01', 'S02'],
  inspectores1: ['Q101', 'Q102'],
  inspector2: ['Q201', 'Q202'],
  charoleros: ['C11', 'C12', 'C13'],
  almacenPT: ['A401', 'A402'],
};

// Cada inyectora tiene 3 operadores habilitados
export function operadoresDe(numMaquina) {
  const base = 1000 + (numMaquina - 1) * 3;
  return [`E${base + 1}`, `E${base + 2}`, `E${base + 3}`];
}

// Tipos de falla que se pueden inyectar desde el panel. `vocea`: a quién llama el voceo (ver src/mes/voceo.js)
export const FALLAS = {
  certificado: { cp: 1, texto: 'Certificado de análisis inválido (lote a cuarentena)', vocea: 'calidad a materia prima' },
  resina: { cp: 4, texto: 'Resina incorrecta en el embudo', vocea: 'supervisor a la mezanina' },
  operador: { cp: 6, texto: 'Operador no habilitado en el arranque', vocea: 'supervisor a la inyectora' },
  qr: { cp: 6, texto: 'QR de otra máquina en el arranque', vocea: 'supervisor a la inyectora' },
  peso: { cp: 7, texto: 'Bolsa fuera de tolerancia de peso' },
  secuencia: { cp: 7, texto: 'Salto en etiqueta correlativa' },
  defecto: { cp: 8, texto: 'Defecto crítico en la inspección TEP 1', vocea: 'calidad a la inyectora' },
  saltoCP10: { cp: 10, texto: 'Charola llega a SM1 sin registrar el retiro (CP 10)', vocea: 'supervisor a SM1' },
  bolsaAjena: { cp: 11, texto: 'Bolsa de otra OT en la caja', vocea: 'calidad a SM1' },
  duplicada: { cp: 11, texto: 'Bolsa escaneada dos veces', vocea: 'calidad a SM1' },
  sinCinta: { cp: 12, texto: 'Caja sin encintar' },
  skuAjeno: { cp: 14, texto: 'Caja de otro número de parte en la tarima', vocea: 'supervisor a PT' },
  camara: { cp: 15, texto: 'La cámara no confirma una cara' },
};
