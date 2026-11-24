// MES: duplicados de radio, alertas y gates centrales que esperan eventos atrasados.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { MES } from '../src/mes/mes.js';
import { relojFalso, carpetaTemporal, ESQUEMA, evento, MIN } from './ayuda.js';

const OT = 'OT-2611-001';
let mes, reloj, publicados;
const alertas = () => publicados.filter((p) => p.topico === 'p/alerta').map((p) => p.json);

beforeEach(() => {
  reloj = relojFalso();
  mes = new MES({ reloj, mqttUrl: 'mqtt://no-se-usa', prefijo: 'p', rutaBD: join(carpetaTemporal(), 'prueba.db'), rutaEsquema: ESQUEMA, porCharola: 4 });
  publicados = [];
  mes.cliente = { publish: (topico, m) => publicados.push({ topico, json: JSON.parse(m) }) };
  mes.q(`INSERT INTO ordenes_trabajo (ot, id_maquina, sku_producto, sku_resina, total_bolsas, estado) VALUES (?, 'L1-INY-07', 'TAP-28-PP', 'RES01', 8, 'EN_PRODUCCION')`).run(OT);
});
afterEach(() => mes.db.close());

// La bolsa 1 sale de la inyectora hasta CP 10 (o hasta el paso que se indique)
function bolsaHasta(cp, k = 1, seq0 = 100) {
  const pasos = { 7: { ot: OT, bolsa: k, peso: 1250, total: 8, operador: 'E1' }, 8: { ot: OT, bolsa: k, charola: 1, operador: 'Q101' }, 9: { ot: OT, charola: 1 }, 10: { ot: OT, charola: 1 } };
  for (const c of [7, 8, 9, 10].filter((c) => c <= cp)) mes.procesarEvento(evento({ seq: seq0 + c, cp: c, datos: pasos[c] }));
}
const enCaja = (k, caja = 'CJ-000001', seq = 1) => mes.procesarEvento(evento({ nodo: 'SM1-01', seq, cp: 11, datos: { ot: OT, bolsa: k, caja, posicion: k, total: 4, operador: 'C11' } }));

test('un evento repetido por la radio (mismo nodo y seq) se guarda una sola vez', () => {
  const ev = evento({ seq: 5, cp: 7, datos: { ot: OT, bolsa: 1, peso: 1250, operador: 'E1' } });
  mes.procesarEvento(ev);
  mes.procesarEvento(ev);
  assert.equal(mes.stats.eventos, 1);
  assert.equal(mes.stats.duplicados, 1);
  assert.equal(mes.q('SELECT COUNT(*) n FROM eventos').get().n, 1);
});

test('un FAIL genera una alerta en MQTT: roja si detiene, ámbar si solo avisa', () => {
  mes.procesarEvento(evento({ seq: 1, cp: 6, resultado: 'FAIL', codigo: 'OPERADOR_NO_HABILITADO', datos: { ot: OT } }));
  mes.procesarEvento(evento({ seq: 2, cp: 7, resultado: 'FAIL', codigo: 'PESO_FUERA_TOLERANCIA', datos: { ot: OT, bolsa: 1 } }));
  const [a, b] = alertas();
  assert.deepEqual([a.codigo, a.nivel, a.nodo, a.cp], ['OPERADOR_NO_HABILITADO', 'rojo', 'L1-INY-07', 6]);
  assert.deepEqual([b.codigo, b.nivel], ['PESO_FUERA_TOLERANCIA', 'ambar']);
  assert.equal(mes.q('SELECT COUNT(*) n FROM alertas').get().n, 2);
});

test('la alerta dice si el evento llegó atrasado y cuándo ocurrió en la terminal (lo usa el voceo)', () => {
  mes.procesarEvento(evento({ seq: 1, cp: 6, resultado: 'FAIL', codigo: 'QR_MAQUINA_INCORRECTO', ts: '2026-11-24T11:40:00.000Z', diferido: true }));
  assert.deepEqual([alertas()[0].diferido, alertas()[0].ts_evento], [true, '2026-11-24T11:40:00.000Z']);
});

test('CP 07–10 llevan la bolsa de moldeada a en traslado', () => {
  bolsaHasta(10);
  assert.equal(mes.q(`SELECT estado FROM bolsas WHERE id_bolsa = 'OT-2611-001-B001'`).get().estado, 'EN_TRASLADO');
});

test('CP 11 sin CP 10 queda pendiente y se concilia cuando llega el evento atrasado', () => {
  bolsaHasta(7);
  enCaja(1);
  assert.equal(mes.pendientes.length, 1);
  bolsaHasta(10); // el charolero estuvo sin señal: CP 08–10 llegan después
  assert.equal(mes.pendientes.length, 0);
  assert.equal(mes.stats.conciliados, 1);
  assert.equal(mes.q(`SELECT estado FROM bolsas WHERE id_bolsa = 'OT-2611-001-B001'`).get().estado, 'EN_CAJA');
  assert.equal(alertas().length, 0);
});

test('si el evento atrasado no llega en 10 minutos, el MES levanta GATE_PREVIO_NO_PASS', () => {
  bolsaHasta(7);
  enCaja(1);
  reloj.avanzar(9 * MIN);
  mes.revisarPendientes();
  assert.equal(alertas().length, 0, 'todavía en plazo');
  reloj.avanzar(2 * MIN);
  mes.revisarPendientes();
  const [a] = alertas();
  assert.deepEqual([a.codigo, a.origen, a.cp, a.nodo], ['GATE_PREVIO_NO_PASS', 'mes', 11, 'SM1-01']);
  assert.equal(mes.pendientes.length, 0);
});

test('una bolsa que ya está en otra caja genera alerta de duplicado del gate central', () => {
  bolsaHasta(10);
  enCaja(1, 'CJ-000001', 1);
  enCaja(1, 'CJ-000002', 2);
  const [a] = alertas();
  assert.deepEqual([a.codigo, a.origen], ['DUPLICADO', 'mes']);
  assert.match(a.mensaje, /CJ-000001/);
});

test('la genealogía de una bolsa la liga a su OT y a su caja', () => {
  bolsaHasta(10);
  enCaja(1);
  const g = mes.genealogia('OT-2611-001-B001');
  assert.ok(g, 'encontró la bolsa');
  assert.equal(JSON.stringify(g).includes('CJ-000001'), true);
  assert.equal(mes.genealogia('OT-2611-001-B099'), null);
});
