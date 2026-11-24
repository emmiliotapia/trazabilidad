// Mantenimiento ASETI: la clave, el bloqueo por intentos y que solo corran acciones de la lista.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { Mantenimiento } from '../src/aseti/mantenimiento.js';
import { MES } from '../src/mes/mes.js';
import { Ajustes } from '../src/ajustes.js';
import { relojFalso, carpetaTemporal, ESQUEMA } from './ayuda.js';

let dir, mes, m, ajustes;
const req = (clave, ip = '10.0.0.1') => ({ headers: clave ? { authorization: `Bearer ${clave}` } : {}, socket: { remoteAddress: ip } });

beforeEach(() => {
  delete process.env.ASETI_TOKEN;
  dir = carpetaTemporal();
  const reloj = relojFalso();
  mes = new MES({ reloj, mqttUrl: 'x', prefijo: 'p', rutaBD: join(dir, 'prueba.db'), rutaEsquema: ESQUEMA, porCharola: 4 });
  ajustes = new Ajustes(join(dir, 'ajustes.json'));
  const nodo = (nombre, bloqueado = false) => ({ nombre, bloqueado, vista: () => ({ nombre, bloqueado, sinSenal: false, conEnlace: true, bufer: 0 }) });
  const original = console.log;
  console.log = () => {}; // aviso de "se creó la clave"
  m = new Mantenimiento({
    dirDatos: dir, version: '0.0.0-prueba', broker: { closed: false, clients: {} }, reloj,
    canal: { stats: {}, sinSenal: new Map([[101, 1], [102, 1]]), ocupacion: () => 0, perdidaBase: 0 },
    puente: { stats: { publicadas: 0, rechazadas: 0 }, cliente: { connected: true } },
    mes, sim: { fallas: [{ tipo: 'peso' }], log() {} },
    nodos: { inyectoras: [nodo('L1-INY-03', true), nodo('L1-INY-04')], mp: nodo('MP-01'), mez: nodo('MEZ-01'), sm1: [], pts: [], vis: nodo('VIS-01') },
    voceo: { stats: { voceados: 0 }, abiertos: new Map(), avisos: null, cliente: { connected: true } },
    ajustes, rutaBD: join(dir, 'prueba.db'),
  });
  console.log = original;
  mes.desbloqueadas = [];
  mes.desbloquear = (n) => (mes.desbloqueadas.push(n), Promise.resolve());
});
afterEach(() => mes.db.close());

test('crea una clave aleatoria en datos/aseti-token.txt y la reutiliza', () => {
  const t = readFileSync(join(dir, 'aseti-token.txt'), 'utf8').trim();
  assert.ok(t.length >= 20);
  assert.equal(m.token, t);
});

test('ASETI_TOKEN tiene prioridad sobre el archivo', () => {
  process.env.ASETI_TOKEN = 'clave-de-entorno';
  assert.equal(m.cargarToken(), 'clave-de-entorno');
  delete process.env.ASETI_TOKEN;
});

test('sin clave o con clave mala responde 401; con la buena deja pasar', () => {
  assert.equal(m.autorizar(req()).codigo, 401);
  assert.equal(m.autorizar(req('mala')).codigo, 401);
  assert.equal(m.autorizar(req(m.token)), null);
});

test('después de 5 claves equivocadas bloquea esa IP, aunque luego use la buena, y no a las demás', () => {
  for (let i = 0; i < 5; i++) m.autorizar(req('mala'));
  assert.equal(m.autorizar(req(m.token)).codigo, 429);
  assert.equal(m.autorizar(req(m.token, '10.0.0.2')), null);
});

test('solo corre acciones de la lista; las demás se rechazan sin ejecutar nada', async () => {
  const r = await m.ejecutar('rm -rf /', req(m.token));
  assert.deepEqual(r, { ok: false, mensaje: 'Acción desconocida' });
  assert.ok(m.acciones().every((a) => /^[a-z_]+$/.test(a.id)));
});

test('las acciones funcionan y quedan en la auditoría con IP', async () => {
  assert.equal((await m.ejecutar('bd_integridad', req(m.token))).ok, true);
  const resp = await m.ejecutar('bd_respaldo', req(m.token));
  assert.equal(resp.ok, true);
  assert.equal(readdirSync(join(dir, 'respaldos')).length, 1);
  assert.match((await m.ejecutar('terminales_desbloquear', req(m.token))).mensaje, /L1-INY-03/);
  assert.deepEqual(mes.desbloqueadas, ['L1-INY-03']);
  assert.match((await m.ejecutar('senal_restablecer', req(m.token))).mensaje, /2 terminales/);
  assert.match((await m.ejecutar('fallas_limpiar', req(m.token))).mensaje, /1 fallas/);
  const log = m.auditoria();
  assert.deepEqual(log.map((l) => l.accion), ['fallas_limpiar', 'senal_restablecer', 'terminales_desbloquear', 'bd_respaldo', 'bd_integridad']);
  assert.ok(log.every((l) => l.ip === '10.0.0.1'));
  assert.ok(existsSync(join(dir, 'auditoria.log')));
});

test('restablecer configuración vuelve a los valores de fábrica', async () => {
  ajustes.guardar({ planta: { nombre: 'Otra' } });
  await m.ejecutar('ajustes_restablecer', req(m.token));
  assert.equal(ajustes.get().planta.nombre, 'Trazabilidad de inyección');
});

test('el diagnóstico trae los chequeos, la base y no se cae con datos mínimos', () => {
  const d = m.diagnostico();
  assert.ok(d.chequeos.length >= 6);
  assert.ok(d.base.tablas.some((t) => t.tabla === 'eventos'));
  assert.equal(d.version, '0.0.0-prueba');
});
