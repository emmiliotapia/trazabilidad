// Protocolo binario sobre LoRa (versión 1).
// Este archivo es la referencia para el firmware del ESP32: el mismo formato byte a byte.
//
//  Cabecera (5 bytes)
//    [0]    versión (4 bits altos) | tipo de mensaje (4 bits bajos)
//    [1..2] id de nodo   (uint16 BE)
//    [3..4] seq          (uint16 BE)
//  Cuerpo según tipo (ver codificar())
//  Firma (4 bytes): HMAC-SHA256(clave_del_nodo, cabecera+cuerpo) truncado
//
//  Campos variables en TLV: [tag uint8][largo uint8][valor]
import crypto from 'node:crypto';

export const VERSION = 1;

export const TIPO = { EVENTO: 1, ESTADO: 2, ACK: 3, CMD: 4, CMD_ACK: 5 };
export const TIPO_NOMBRE = invertir(TIPO);

// Resultado de un gate: 0 = PASS, cualquier otro valor = código de falla
export const FALLA = {
  PASS: 0,
  CERTIFICADO_INVALIDO: 1,
  GATE_PREVIO_NO_PASS: 2,
  RESINA_INCORRECTA: 3,
  OT_NO_ASIGNADA: 4,
  OPERADOR_NO_HABILITADO: 5,
  QR_MAQUINA_INCORRECTO: 6,
  NODO_BLOQUEADO: 7,
  PESO_FUERA_TOLERANCIA: 8,
  SECUENCIA_ROTA: 9,
  DEFECTO_CRITICO: 10,
  BOLSA_OTRA_OT: 11,
  DUPLICADO: 12,
  CAJA_LLENA: 13,
  CAJA_INCOMPLETA: 14,
  CAJA_SIN_ENCINTAR: 15,
  SKU_NO_COINCIDE: 16,
  TARIMA_INCOMPLETA: 17,
  CAMARA_NO_CONFIRMA: 18,
};
export const FALLA_NOMBRE = invertir(FALLA);

export const FALLA_TEXTO = {
  PASS: 'Correcto',
  CERTIFICADO_INVALIDO: 'Certificado de análisis inválido',
  GATE_PREVIO_NO_PASS: 'El checkpoint anterior no está en PASS',
  RESINA_INCORRECTA: 'La resina no coincide con la formulación de la OT',
  OT_NO_ASIGNADA: 'La OT no está asignada a esta estación',
  OPERADOR_NO_HABILITADO: 'Operador no habilitado para esta OT',
  QR_MAQUINA_INCORRECTO: 'El QR no corresponde a esta máquina',
  NODO_BLOQUEADO: 'Terminal bloqueada, requiere supervisor',
  PESO_FUERA_TOLERANCIA: 'Peso fuera de tolerancia',
  SECUENCIA_ROTA: 'Salto en la secuencia correlativa',
  DEFECTO_CRITICO: 'Defecto crítico en la muestra',
  BOLSA_OTRA_OT: 'La bolsa pertenece a otra OT',
  DUPLICADO: 'Código duplicado',
  CAJA_LLENA: 'La caja ya está completa',
  CAJA_INCOMPLETA: 'La caja no está completa',
  CAJA_SIN_ENCINTAR: 'Caja sin cinta de seguridad',
  SKU_NO_COINCIDE: 'El número de parte no coincide con la orden de embarque',
  TARIMA_INCOMPLETA: 'Tarima incompleta',
  CAMARA_NO_CONFIRMA: 'La cámara cenital no confirma la cara escaneada',
};

export const CMD = { CARGAR_OT: 1, DESBLOQUEAR: 2, FIN_OT: 3, CARGAR_FORMULA: 4 };
export const CMD_NOMBRE = invertir(CMD);

// Campos TLV: nombre → [tag, tipo]. s = texto, u8/u16 = entero, l = lista de textos separados por coma
export const CAMPOS = {
  ot: [1, 's'],
  operador: [2, 's'],
  maquina: [3, 's'],
  lote: [4, 's'],
  bolsa: [5, 'u16'],
  total: [6, 'u16'],
  peso: [7, 'u16'],
  caja: [8, 's'],
  posicion: [9, 'u8'],
  skuResina: [10, 's'],
  embudo: [11, 's'],
  tarima: [12, 's'],
  cara: [13, 'u8'],
  camara: [14, 'u8'],
  ubicacion: [15, 's'],
  puerta: [16, 's'],
  cantidad: [17, 'u16'],
  charola: [18, 'u8'],
  defecto: [19, 'u8'],
  pesoNominal: [20, 'u16'],
  tolerancia: [21, 'u16'],
  operadores: [22, 'l'],
  skuProducto: [23, 's'],
  orden: [24, 's'],
  numeroParte: [25, 's'],
  proveedor: [26, 's'],
  cierre: [27, 'u8'],
};
const POR_TAG = Object.fromEntries(Object.entries(CAMPOS).map(([n, [t, tipo]]) => [t, [n, tipo]]));

function invertir(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
}

export function claveNodo(claveRed, nodoId) {
  return crypto.createHmac('sha256', claveRed).update(`nodo:${nodoId}`).digest();
}

function firma(clave, buf) {
  return crypto.createHmac('sha256', clave).update(buf).digest().subarray(0, 4);
}

function codificarCampos(datos = {}) {
  const partes = [];
  for (const [nombre, valor] of Object.entries(datos)) {
    if (valor === undefined || valor === null) continue;
    const def = CAMPOS[nombre];
    if (!def) throw new Error(`Campo desconocido en trama: ${nombre}`);
    const [tag, tipo] = def;
    let v;
    if (tipo === 's') v = Buffer.from(String(valor), 'latin1');
    else if (tipo === 'l') v = Buffer.from(valor.join(','), 'latin1');
    else if (tipo === 'u8') v = Buffer.from([Number(valor) & 0xff]);
    else {
      v = Buffer.alloc(2);
      v.writeUInt16BE(Math.max(0, Math.min(0xffff, Math.round(valor))));
    }
    if (v.length > 255) throw new Error(`Campo demasiado largo: ${nombre}`);
    partes.push(Buffer.from([tag, v.length]), v);
  }
  return Buffer.concat(partes);
}

function decodificarCampos(buf) {
  const datos = {};
  let i = 0;
  while (i + 2 <= buf.length) {
    const tag = buf[i];
    const largo = buf[i + 1];
    const v = buf.subarray(i + 2, i + 2 + largo);
    i += 2 + largo;
    const def = POR_TAG[tag];
    if (!def) continue; // campo desconocido: se ignora (compatibilidad hacia adelante)
    const [nombre, tipo] = def;
    if (tipo === 's') datos[nombre] = v.toString('latin1');
    else if (tipo === 'l') datos[nombre] = v.length ? v.toString('latin1').split(',') : [];
    else if (tipo === 'u8') datos[nombre] = v[0];
    else datos[nombre] = v.readUInt16BE(0);
  }
  return datos;
}

export function codificar(msg, clave) {
  const cab = Buffer.alloc(5);
  cab[0] = (VERSION << 4) | msg.tipo;
  cab.writeUInt16BE(msg.nodo, 1);
  cab.writeUInt16BE((msg.seq ?? 0) & 0xffff, 3);

  let cuerpo;
  switch (msg.tipo) {
    case TIPO.EVENTO: {
      const b = Buffer.alloc(6);
      b[0] = msg.cp;
      b[1] = msg.resultado;
      b.writeUInt32BE(msg.ts >>> 0, 2);
      cuerpo = Buffer.concat([b, codificarCampos(msg.datos)]);
      break;
    }
    case TIPO.ESTADO: {
      const b = Buffer.alloc(7);
      b.writeUInt32BE(msg.ts >>> 0, 0);
      b.writeUInt16BE(Math.min(0xffff, msg.bufer), 4);
      b[6] = msg.bloqueado ? 1 : 0;
      cuerpo = Buffer.concat([b, codificarCampos(msg.datos)]);
      break;
    }
    case TIPO.ACK: {
      const b = Buffer.alloc(6);
      b.writeUInt16BE(msg.seqAck & 0xffff, 0);
      b.writeUInt32BE(msg.ts >>> 0, 2);
      cuerpo = b;
      break;
    }
    case TIPO.CMD:
      cuerpo = Buffer.concat([Buffer.from([msg.codigo]), codificarCampos(msg.datos)]);
      break;
    case TIPO.CMD_ACK: {
      const b = Buffer.alloc(3);
      b.writeUInt16BE(msg.seqCmd & 0xffff, 0);
      b[2] = msg.resultado;
      cuerpo = b;
      break;
    }
    default:
      throw new Error(`Tipo de trama desconocido: ${msg.tipo}`);
  }
  const sinFirma = Buffer.concat([cab, cuerpo]);
  return Buffer.concat([sinFirma, firma(clave, sinFirma)]);
}

export function leerCabecera(buf) {
  if (buf.length < 9) return null;
  return { version: buf[0] >> 4, tipo: buf[0] & 0x0f, nodo: buf.readUInt16BE(1), seq: buf.readUInt16BE(3) };
}

export function decodificar(buf, clave) {
  const cab = leerCabecera(buf);
  if (!cab) return { ok: false, error: 'TRAMA_CORTA' };
  if (cab.version !== VERSION) return { ok: false, error: 'VERSION', ...cab };
  const cuerpoFirmado = buf.subarray(0, buf.length - 4);
  const recibida = buf.subarray(buf.length - 4);
  if (!crypto.timingSafeEqual(recibida, firma(clave, cuerpoFirmado))) return { ok: false, error: 'FIRMA', ...cab };

  const c = buf.subarray(5, buf.length - 4);
  const m = { ok: true, ...cab };
  switch (cab.tipo) {
    case TIPO.EVENTO:
      m.cp = c[0];
      m.resultado = c[1];
      m.ts = c.readUInt32BE(2);
      m.datos = decodificarCampos(c.subarray(6));
      break;
    case TIPO.ESTADO:
      m.ts = c.readUInt32BE(0);
      m.bufer = c.readUInt16BE(4);
      m.bloqueado = c[6] === 1;
      m.datos = decodificarCampos(c.subarray(7));
      break;
    case TIPO.ACK:
      m.seqAck = c.readUInt16BE(0);
      m.ts = c.readUInt32BE(2);
      break;
    case TIPO.CMD:
      m.codigo = c[0];
      m.datos = decodificarCampos(c.subarray(1));
      break;
    case TIPO.CMD_ACK:
      m.seqCmd = c.readUInt16BE(0);
      m.resultado = c[2];
      break;
    default:
      return { ok: false, error: 'TIPO', ...cab };
  }
  return m;
}

export const hex = (buf) => buf.toString('hex').match(/../g).join(' ');
