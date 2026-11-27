// Ejemplos para la prueba de paridad con el ESP32 (firmware/paridad).
// trama.js es la referencia: aquí se calcula lo que el ESP32 debe producir y entender,
// y se imprime como JSON. Lo usa firmware/paridad/comparar.py, que es quien habla con la placa.
//
//   node herramientas/vectores-paridad.mjs
//
// Los ejemplos de "subida" deben ser los mismos que arma firmware/paridad/src/main.cpp.
import { codificar, claveNodo, TIPO, FALLA, CMD, CAMPOS } from '../src/protocolo/trama.js';
import { CONFIG } from '../src/config.js';

const arma = (msg) => codificar(msg, claveNodo(CONFIG.claveRed, msg.nodo));
const OT = 'OT-2611-042';

// Lo que el ESP32 debe armar (nodo → gateway)
const SUBIDA = [
  { nombre: 'CP 06 arranque correcto', msg: { tipo: TIPO.EVENTO, nodo: 106, seq: 1, cp: 6, resultado: FALLA.PASS, ts: 1795000000, datos: { ot: OT, operador: 'E1023', maquina: 'L1-INY-06' } } },
  { nombre: 'CP 07 peso fuera de tolerancia', msg: { tipo: TIPO.EVENTO, nodo: 205, seq: 65535, cp: 7, resultado: FALLA.PESO_FUERA_TOLERANCIA, ts: 1795000123, datos: { ot: OT, bolsa: 3, total: 12, peso: 1250, operador: 'E1023' } } },
  { nombre: 'Latido de estado', msg: { tipo: TIPO.ESTADO, nodo: 205, seq: 7, ts: 1795000200, bufer: 3, bloqueado: true, datos: { ot: OT } } },
  { nombre: 'Confirmación de comando', msg: { tipo: TIPO.CMD_ACK, nodo: 106, seq: 9, seqCmd: 4, resultado: FALLA.PASS } },
  { nombre: 'CP 11 bolsa duplicada en SM1', msg: { tipo: TIPO.EVENTO, nodo: 911, seq: 300, cp: 11, resultado: FALLA.DUPLICADO, ts: 1795000300, datos: { ot: OT, bolsa: 5, caja: 'CJ-0001', posicion: 2, total: 4, operador: 'E2001' } } },
];

// Lo que el ESP32 debe leer (gateway → nodo)
const cargarOT = { tipo: TIPO.CMD, nodo: 106, seq: 5, codigo: CMD.CARGAR_OT, datos: { ot: OT, skuProducto: 'TAPA-38', skuResina: 'PP-H110', total: 12, pesoNominal: 1250, tolerancia: 25, operadores: ['E1023', 'E1044'] } };
const alterada = arma(cargarOT);
alterada[8] ^= 0x01; // un solo bit cambiado en el camino

const campos = (datos) =>
  Object.entries(datos)
    .map(([n, v]) => ` ${n}=${CAMPOS[n][1] === 'l' ? v.join(',') : v}`)
    .join('');

const BAJADA = [
  { nombre: 'ACK del evento 1', buf: arma({ tipo: TIPO.ACK, nodo: 106, seq: 0, seqAck: 1, ts: 1795000001 }), espera: 'D OK tipo=3 nodo=106 seq=0 seqAck=1 ts=1795000001' },
  { nombre: 'Comando cargar OT', buf: arma(cargarOT), espera: `D OK tipo=4 nodo=106 seq=5 codigo=1${campos(cargarOT.datos)}` },
  { nombre: 'Comando alterado (debe rechazarse)', buf: alterada, espera: 'D ERR FIRMA' },
];

console.log(
  JSON.stringify({
    subida: SUBIDA.map((v) => ({ nombre: v.nombre, hex: arma(v.msg).toString('hex') })),
    bajada: BAJADA.map((v) => ({ nombre: v.nombre, hex: v.buf.toString('hex'), espera: v.espera })),
  }),
);
