// Voceo: qué alertas se anuncian, a quién se llama y las reglas para no saturar el altavoz.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Voceo } from '../src/mes/voceo.js';
import { PREDETERMINADOS } from '../src/ajustes.js';
import { leerCatalogo, construirAvisos } from '../../voceo/avisos.mjs';
import { relojFalso, MIN } from './ayuda.js';

const AVISOS = construirAvisos(leerCatalogo());
let reloj, voceo, publicados, ajustes;

beforeEach(() => {
  reloj = relojFalso();
  ajustes = structuredClone(PREDETERMINADOS.voceo);
  voceo = new Voceo({ reloj, prefijo: 'p', avisos: AVISOS, ajustes: () => ajustes });
  publicados = [];
  voceo.cliente = { publish: (topico, m) => publicados.push({ topico, ...JSON.parse(m) }) };
});

const alerta = (codigo, extra = {}) => voceo.alAlerta({ ts: reloj.iso(), codigo, cp: 6, nodo: 'L2-INY-07', nivel: 'rojo', ot: 'OT-1', ...extra });
const ultimo = () => voceo.historial[0];

test('un operador no habilitado llama al supervisor a esa inyectora, con el MP3 y el texto', () => {
  alerta('OPERADOR_NO_HABILITADO');
  assert.equal(publicados.length, 1);
  const m = publicados[0];
  assert.equal(m.topico, 'p/voceo');
  assert.deepEqual([m.rol, m.destino, m.archivo, m.repetir, m.escalamiento], ['supervisor', 'L2-INY-07', 'supervisor__L2-INY-07.mp3', 2, 0]);
  assert.equal(m.texto, 'Supervisor de producción, favor de acudir a línea dos, inyectora siete.');
  assert.equal(m.alerta.codigo, 'OPERADOR_NO_HABILITADO');
});

test('cada código llama al rol que dice la tabla, y la cámara se vocea como embarque', () => {
  alerta('DEFECTO_CRITICO', { cp: 8 });
  alerta('RESINA_INCORRECTA', { cp: 4, nodo: 'MEZ-01' });
  alerta('SKU_NO_COINCIDE', { cp: 15, nodo: 'VIS-01' });
  assert.deepEqual(publicados.map((p) => p.archivo), ['calidad__L2-INY-07.mp3', 'supervisor__MEZ-01.mp3', 'supervisor__EMB-01.mp3']);
});

test('las alertas ámbar se quedan en el panel', () => {
  alerta('PESO_FUERA_TOLERANCIA', { cp: 7 });
  assert.equal(publicados.length, 0);
  assert.deepEqual([ultimo().estado, ultimo().motivo], ['omitido', 'no se vocea, solo panel']);
});

test('el mismo llamado no se repite antes de 5 minutos', () => {
  alerta('OPERADOR_NO_HABILITADO');
  reloj.avanzar(1 * MIN);
  alerta('NODO_BLOQUEADO');
  assert.equal(publicados.length, 1);
  assert.match(ultimo().motivo, /menos de 5 min/);
});

test('un evento que llegó con más de 2 minutos de atraso no se vocea', () => {
  alerta('QR_MAQUINA_INCORRECTO', { diferido: true, ts_evento: new Date(reloj.ahora() - 10 * MIN).toISOString() });
  assert.equal(publicados.length, 0);
  assert.match(ultimo().motivo, /10 min de atraso/);
  alerta('QR_MAQUINA_INCORRECTO', { diferido: true, ts_evento: new Date(reloj.ahora() - 1 * MIN).toISOString() });
  assert.equal(publicados.length, 1, 'un atraso corto sí se vocea');
});

test('si la máquina sigue bloqueada se vuelve a vocear a los 5 y 10 minutos, y ya no más', () => {
  alerta('OPERADOR_NO_HABILITADO');
  reloj.avanzar(4 * MIN);
  assert.equal(publicados.length, 1);
  reloj.avanzar(1 * MIN);
  reloj.avanzar(5 * MIN);
  reloj.avanzar(30 * MIN);
  assert.deepEqual(publicados.map((p) => p.escalamiento), [0, 1, 2]);
  assert.equal(voceo.abiertos.size, 0);
});

test('al desbloquear la terminal se cancela el escalamiento', () => {
  alerta('OPERADOR_NO_HABILITADO');
  reloj.avanzar(2 * MIN);
  voceo.resolver('L2-INY-07', 'terminal desbloqueada');
  reloj.avanzar(30 * MIN);
  assert.equal(publicados.length, 1);
  assert.equal(ultimo().estado, 'resuelto');
});

test('los ajustes cambian la tabla, los tiempos y pueden apagar el voceo', () => {
  ajustes.reglas.DEFECTO_CRITICO = 'mantenimiento';
  ajustes.repetir = 3;
  alerta('DEFECTO_CRITICO', { cp: 8 });
  assert.deepEqual([publicados[0].archivo, publicados[0].repetir], ['mantenimiento__L2-INY-07.mp3', 3]);
  ajustes.reglas.DEFECTO_CRITICO = '';
  alerta('DEFECTO_CRITICO', { cp: 8, nodo: 'L1-INY-01' });
  assert.equal(publicados.length, 1);
  ajustes.activo = false;
  alerta('OPERADOR_NO_HABILITADO', { nodo: 'L1-INY-01' });
  assert.equal(publicados.length, 1);
  assert.match(ultimo().motivo, /apagado/);
});

test('si no hay aviso grabado para ese rol y lugar, no se publica', () => {
  alerta('OPERADOR_NO_HABILITADO', { nodo: 'L9-INY-99' });
  assert.equal(publicados.length, 0);
  assert.match(ultimo().motivo, /no hay aviso/);
});

test('la prueba manual publica avisos generales sin rol ni destino', () => {
  const m = voceo.vocear('general__prueba_sistema');
  assert.deepEqual([m.rol, m.destino, m.general, m.alerta], [null, null, 'prueba_sistema', null]);
});
