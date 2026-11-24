// Protocolo LoRa v1: es la referencia del firmware, así que cada byte importa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codificar, decodificar, leerCabecera, claveNodo, TIPO, FALLA, CMD, VERSION } from '../src/protocolo/trama.js';

const clave = claveNodo('red', 112);

test('un EVENTO se codifica y se decodifica igual, con sus campos', () => {
  const msg = { tipo: TIPO.EVENTO, nodo: 112, seq: 10, cp: 7, resultado: FALLA.PASS, ts: 1795000000, datos: { ot: 'OT-2611-018', bolsa: 1, total: 12, peso: 2400, operador: 'E1034' } };
  const buf = codificar(msg, clave);
  const m = decodificar(buf, clave);
  assert.equal(m.ok, true);
  assert.deepEqual({ tipo: m.tipo, nodo: m.nodo, seq: m.seq, cp: m.cp, resultado: m.resultado, ts: m.ts }, { tipo: TIPO.EVENTO, nodo: 112, seq: 10, cp: 7, resultado: 0, ts: 1795000000 });
  assert.deepEqual(m.datos, msg.datos);
});

test('el ejemplo de la documentación (bolsa 1 de 12, CP 07) ocupa 47 bytes', () => {
  const buf = codificar({ tipo: TIPO.EVENTO, nodo: 112, seq: 10, cp: 7, resultado: 0, ts: 1795000000, datos: { ot: 'OT-2611-018', bolsa: 1, total: 12, peso: 2400, operador: 'E1034' } }, clave);
  assert.equal(buf.length, 47);
});

test('la cabecera lleva versión, tipo, nodo y seq en los primeros 5 bytes', () => {
  const buf = codificar({ tipo: TIPO.ACK, nodo: 0x0102, seq: 0x0304, seqAck: 9, ts: 1 }, clave);
  assert.equal(buf[0], (VERSION << 4) | TIPO.ACK);
  assert.deepEqual(leerCabecera(buf), { version: VERSION, tipo: TIPO.ACK, nodo: 0x0102, seq: 0x0304 });
});

test('ESTADO, ACK, CMD y CMD_ACK sobreviven el viaje', () => {
  const casos = [
    [{ tipo: TIPO.ESTADO, nodo: 112, seq: 3, ts: 99, bufer: 5, bloqueado: true, datos: { ot: 'OT-1-1' } }, (m) => assert.deepEqual([m.ts, m.bufer, m.bloqueado, m.datos.ot], [99, 5, true, 'OT-1-1'])],
    [{ tipo: TIPO.ACK, nodo: 112, seq: 4, seqAck: 77, ts: 123 }, (m) => assert.deepEqual([m.seqAck, m.ts], [77, 123])],
    [{ tipo: TIPO.CMD, nodo: 112, seq: 5, codigo: CMD.CARGAR_OT, datos: { ot: 'OT-1-1', operadores: ['E1', 'E2'], tolerancia: 40 } }, (m) => assert.deepEqual([m.codigo, m.datos.operadores, m.datos.tolerancia], [CMD.CARGAR_OT, ['E1', 'E2'], 40])],
    [{ tipo: TIPO.CMD_ACK, nodo: 112, seq: 6, seqCmd: 5, resultado: FALLA.PASS }, (m) => assert.deepEqual([m.seqCmd, m.resultado], [5, 0])],
  ];
  for (const [msg, revisar] of casos) {
    const m = decodificar(codificar(msg, clave), clave);
    assert.equal(m.ok, true, `tipo ${msg.tipo}`);
    revisar(m);
  }
});

test('una trama alterada o firmada con otra clave se rechaza por FIRMA', () => {
  const buf = codificar({ tipo: TIPO.EVENTO, nodo: 112, seq: 1, cp: 6, resultado: 0, ts: 1, datos: { ot: 'OT-1-1' } }, clave);
  const alterada = Buffer.from(buf);
  alterada[6] ^= 0x01; // cambia el resultado
  assert.equal(decodificar(alterada, clave).error, 'FIRMA');
  assert.equal(decodificar(buf, claveNodo('red', 113)).error, 'FIRMA');
});

test('tramas cortas, de otra versión o de tipo desconocido no se aceptan', () => {
  assert.equal(decodificar(Buffer.alloc(5), clave).error, 'TRAMA_CORTA');
  const buf = codificar({ tipo: TIPO.ACK, nodo: 1, seq: 1, seqAck: 1, ts: 1 }, clave);
  const v2 = Buffer.from(buf);
  v2[0] = (2 << 4) | TIPO.ACK;
  assert.equal(decodificar(v2, clave).error, 'VERSION');
  assert.throws(() => codificar({ tipo: 9, nodo: 1 }, clave), /desconocido/);
});

test('seq da la vuelta en 16 bits y los enteros se recortan a su rango', () => {
  const m = decodificar(codificar({ tipo: TIPO.EVENTO, nodo: 1, seq: 0x1_0005, cp: 7, resultado: 0, ts: 1, datos: { peso: 70000 } }, clave), clave);
  assert.equal(m.seq, 5);
  assert.equal(m.datos.peso, 0xffff);
});

test('un campo que el firmware no conoce se rechaza al codificar', () => {
  assert.throws(() => codificar({ tipo: TIPO.EVENTO, nodo: 1, seq: 1, cp: 1, resultado: 0, ts: 1, datos: { inventado: 1 } }, clave), /Campo desconocido/);
});

test('cada nodo tiene una clave distinta derivada de la clave de red', () => {
  assert.notDeepEqual(claveNodo('red', 101), claveNodo('red', 102));
  assert.deepEqual(claveNodo('red', 101), claveNodo('red', 101));
});
