// De punta a punta con piezas reales: terminal → radio LoRa simulada → puente → broker MQTT → MES → voceo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { join } from 'node:path';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { CanalLoRa } from '../src/radio/canal-lora.js';
import { PuenteLoRaMQTT } from '../src/puente/puente-lora-mqtt.js';
import { MES } from '../src/mes/mes.js';
import { Voceo } from '../src/mes/voceo.js';
import { NodoInyectora } from '../src/nodo/estaciones.js';
import { claveNodo, CMD } from '../src/protocolo/trama.js';
import { leerCatalogo, construirAvisos } from '../../voceo/avisos.mjs';
import { RelojPrueba, carpetaTemporal, ESQUEMA, CFG_NODO } from './ayuda.js';

const PREFIJO = 'prueba/p1';
const CLAVE_RED = 'red-de-prueba';
let broker, servidor, url, puente, mes, voceo, oyente, nodo, reloj;
const recibidos = [];

// Espera hasta que se cumpla la condición (tiempo real), o falla
async function hasta(cond, ms = 8000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('no se cumplió a tiempo');
}

before(async () => {
  broker = await Aedes.createBroker();
  servidor = net.createServer(broker.handle);
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `mqtt://127.0.0.1:${servidor.address().port}`;

  reloj = new RelojPrueba(60); // 60x: los tiempos de radio y reintentos pasan rápido
  const canal = new CanalLoRa(reloj, { sf: 7, bw: 125000, cr: 1, preambulo: 8, perdidaBase: 0 });
  nodo = new NodoInyectora({ id: 205, nombre: 'L2-INY-05', canal, canalLoRa: 2, reloj, clave: claveNodo(CLAVE_RED, 205), cfg: CFG_NODO, enlace: { rssi: -85, snr: 8 }, porCharola: 4 });
  puente = new PuenteLoRaMQTT({ canal, reloj, mqttUrl: url, prefijo: PREFIJO, claveRed: CLAVE_RED, nodos: [nodo] });
  await puente.iniciar();
  mes = new MES({ reloj, mqttUrl: url, prefijo: PREFIJO, rutaBD: join(carpetaTemporal(), 'prueba.db'), rutaEsquema: ESQUEMA, porCharola: 4 });
  await mes.iniciar();
  voceo = new Voceo({ reloj, mqttUrl: url, prefijo: PREFIJO, avisos: construirAvisos(leerCatalogo()) });
  await voceo.iniciar();

  oyente = mqtt.connect(url, { clientId: 'prueba-oyente' });
  await new Promise((ok) => oyente.once('connect', ok));
  await oyente.subscribeAsync(`${PREFIJO}/#`);
  oyente.on('message', (topico, payload) => recibidos.push({ topico: topico.slice(PREFIJO.length + 1), json: JSON.parse(payload.toString()) }));
});

after(async () => {
  voceo.cerrar();
  mes.cerrar();
  oyente.end(true);
  puente.cliente.end(true);
  await new Promise((ok) => broker.close(ok));
  servidor.close();
});

const de = (topico) => recibidos.filter((r) => r.topico === topico);

test('un arranque con operador no habilitado termina en el altavoz llamando al supervisor', async () => {
  nodo.manejarComando(CMD.CARGAR_OT, { ot: 'OT-2611-050', total: 8, pesoNominal: 1250, tolerancia: 25, operadores: ['E1001'] });
  const r = nodo.arrancar({ gafete: 'E9999', ot: 'OT-2611-050', qr: nodo.qr });
  assert.equal(r.codigo, 'OPERADOR_NO_HABILITADO');

  // 1. El puente recibió la trama, la validó y la publicó como JSON
  await hasta(() => de('nodo/L2-INY-05/evento').length > 0);
  const ev = de('nodo/L2-INY-05/evento')[0].json;
  assert.deepEqual([ev.cp, ev.resultado, ev.codigo, ev.datos.operador], [6, 'FAIL', 'OPERADOR_NO_HABILITADO', 'E9999']);

  // 2. La terminal recibió su ACK y vació el búfer
  await hasta(() => nodo.cola.length === 0);

  // 3. El MES guardó el evento y publicó la alerta
  await hasta(() => de('alerta').length > 0);
  assert.equal(mes.q(`SELECT COUNT(*) n FROM eventos WHERE nodo = 'L2-INY-05' AND cp = 6`).get().n, 1);

  // 4. El voceo publicó el aviso para el conmutador
  await hasta(() => de('voceo').length > 0);
  const aviso = de('voceo')[0].json;
  assert.deepEqual([aviso.rol, aviso.destino, aviso.archivo], ['supervisor', 'L2-INY-05', 'supervisor__L2-INY-05.mp3']);
  assert.equal(aviso.texto, 'Supervisor de producción, favor de acudir a línea dos, inyectora cinco.');
});

test('el supervisor desbloquea desde el MES: el comando viaja por LoRa y se cancela el voceo', async () => {
  assert.equal(nodo.bloqueado, true);
  const r = await mes.desbloquear('L2-INY-05');
  assert.equal(r.resultado, 'PASS');
  assert.equal(nodo.bloqueado, false);
  await hasta(() => voceo.historial.some((h) => h.estado === 'resuelto'));
  assert.equal(voceo.abiertos.size, 0);
});
