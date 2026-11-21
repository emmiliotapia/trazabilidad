// Arranque del simulador: broker MQTT + canal LoRa + nodos + puente + MES + escenarios + panel.
//   npm start                → panel en http://localhost:8080 y MQTT en localhost:1883
//   npm run prueba -- 60     → corre 60 s sin panel y muestra un resumen
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Aedes } from 'aedes';
import { CONFIG } from './config.js';
import { Reloj, azar } from './reloj.js';
import { claveNodo } from './protocolo/trama.js';
import { CanalLoRa } from './radio/canal-lora.js';
import { NodoInyectora, NodoAlmacenMP, NodoMezanina, NodoSM1, NodoAlmacenPT, NodoVision } from './nodo/estaciones.js';
import { PuenteLoRaMQTT } from './puente/puente-lora-mqtt.js';
import { MES } from './mes/mes.js';
import { Simulacion } from './sim/simulacion.js';
import { iniciarWeb } from './web/servidor.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const modoPrueba = args.includes('--prueba');
const duracionPrueba = Number(args.find((a) => /^\d+$/.test(a)) ?? 60);

const cfg = CONFIG;
if (modoPrueba && !process.env.VELOCIDAD) cfg.produccion.velocidad = 40;
const reloj = new Reloj(cfg.produccion.velocidad);

// 1 · Broker MQTT (en planta: Mosquitto)
const broker = await Aedes.createBroker();
const servidorMqtt = net.createServer(broker.handle);
await new Promise((ok, mal) => {
  servidorMqtt.once('error', (e) => mal(new Error(`No se pudo abrir MQTT en el puerto ${cfg.mqtt.puerto} (${e.code}). Use PUERTO_MQTT=1884 npm start`)));
  servidorMqtt.listen(cfg.mqtt.puerto, cfg.host, ok);
});
const mqttUrl = `mqtt://localhost:${cfg.mqtt.puerto}`;

// 2 · Radio LoRa simulada
const canal = new CanalLoRa(reloj, cfg.lora);

// 3 · Nodos (terminales de estación)
const base = (id, nombre, rssi) => ({ id, nombre, canal, reloj, clave: claveNodo(cfg.claveRed, id), cfg: cfg.nodo, enlace: { rssi, snr: rssi > -100 ? 8 : 2 } });
const nodos = {
  inyectoras: Array.from({ length: cfg.produccion.inyectoras }, (_, i) => {
    const nombre = `INY-${String(i + 1).padStart(2, '0')}`;
    return new NodoInyectora({ ...base(i + 1, nombre, Math.round(azar(-108, -78))), porCharola: cfg.produccion.bolsasPorCaja });
  }),
  mp: new NodoAlmacenMP(base(30, 'MP-01', -95)),
  mez: new NodoMezanina(base(31, 'MEZ-01', -113)), // 2do piso: la señal más débil
  sm1: [new NodoSM1(base(40, 'SM1-01', -88)), new NodoSM1(base(41, 'SM1-02', -90))], // dos mesas con pantalla AV
  pt: new NodoAlmacenPT(base(50, 'PT-01', -98)),
  vis: new NodoVision(base(51, 'VIS-01', -101)),
};
const lista = [...nodos.inyectoras, nodos.mp, nodos.mez, ...nodos.sm1, nodos.pt, nodos.vis];

// 4 · Puente LoRa ↔ MQTT
const puente = new PuenteLoRaMQTT({ canal, reloj, mqttUrl, prefijo: cfg.mqtt.prefijo, claveRed: cfg.claveRed, nodos: lista });
await puente.iniciar();

// 5 · MES central
const mes = new MES({ reloj, mqttUrl, prefijo: cfg.mqtt.prefijo, rutaBD: join(raiz, 'datos', 'trazabilidad.db'), rutaEsquema: join(raiz, 'sql', 'esquema.sql'), porCharola: cfg.produccion.bolsasPorCaja });
await mes.iniciar();

// 6 · Escenarios (las personas en planta)
const sim = new Simulacion({ reloj, mes, canal, nodos, cfg: cfg.produccion });

if (modoPrueba) {
  for (const f of ['resina', 'operador', 'peso', 'bolsaAjena', 'duplicada', 'sinCinta', 'camara', 'saltoCP10']) sim.inyectar(f);
  reloj.timeout(() => canal.cortarSenal(3, 15 * 60 * 1000), 5 * 60 * 1000);
  sim.iniciar();
  console.log(`Prueba: ${duracionPrueba} s reales a ${reloj.velocidad}x (≈ ${Math.round((duracionPrueba * reloj.velocidad) / 60)} min simulados)…`);
  setTimeout(() => {
    const r = mes.resumen();
    console.log('\nRadio:', { ...canal.stats, ocupacion: `${(canal.ocupacion() * 100).toFixed(1)} %` });
    console.log('Puente:', puente.stats);
    console.log('MES:', r.stats);
    console.log('OTs por estado:', r.ots, '· bolsas', r.bolsas, '· cajas', r.cajas, '· tarimas despachadas', r.tarimasDespachadas);
    console.log('Eventos por CP:', Object.entries(r.porCP).map(([cp, v]) => `CP${cp}:${v.pass}/${v.fail}`).join('  '));
    console.log('Alertas:');
    for (const a of r.alertas.slice(0, 20).reverse()) console.log(`  [${a.nivel}/${a.origen}] CP${a.cp} ${a.nodo ?? ''} ${a.codigo}: ${a.mensaje}`);
    console.log('Búfer por nodo:', lista.filter((n) => n.cola.length).map((n) => `${n.nombre}:${n.cola.length}`).join(' ') || 'vacío');
    const ot = r.otsRecientes.find((o) => o.estado === 'COMPLETO');
    if (ot) {
      const g = mes.genealogia(ot.ot);
      console.log(`\nGenealogía ${ot.ot}: lotes ${g.lotes.map((l) => l.id_lote).join(',')} → ${g.cajas.length} cajas → tarima ${g.cajas[0]?.id_tarima} · ${g.eventos.length} eventos`);
    }
    process.exit(0);
  }, duracionPrueba * 1000);
} else {
  const web = await iniciarWeb({ puerto: cfg.http.puerto, host: cfg.host, carpeta: join(raiz, 'public'), mqttUrl, prefijo: cfg.mqtt.prefijo, reloj, canal, puente, mes, sim, nodos, cfg });
  sim.iniciar();
  console.log(`
  Simulador de trazabilidad ASETI
  ───────────────────────────────
  Panel:   http://localhost:${cfg.http.puerto}
  MQTT:    ${mqttUrl}   (tópicos ${cfg.mqtt.prefijo}/#)
  Base:    datos/trazabilidad.db
  Nodos:   ${lista.length} (${cfg.produccion.inyectoras} inyectoras + MP, mezanina, 2 mesas SM1, PT, visión)
  Ctrl+C para salir.
`);
  const salir = () => {
    sim.detener();
    web.cerrar();
    mes.cerrar();
    process.exit(0);
  };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}
