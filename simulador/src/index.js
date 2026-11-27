// Arranque del simulador: broker MQTT + canal LoRa + nodos + puente + MES + escenarios + panel.
//   npm start                → panel en http://localhost:8080 y MQTT en localhost:1883
//   npm run prueba -- 60     → corre 60 s sin panel y muestra un resumen
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Aedes } from 'aedes';
import { CONFIG } from './config.js';
import { Reloj, azar } from './reloj.js';
import { claveNodo } from './protocolo/trama.js';
import { CanalLoRa } from './radio/canal-lora.js';
import { NodoInyectora, NodoAlmacenMP, NodoMezanina, NodoSM1, NodoAlmacenPT, NodoVision } from './nodo/estaciones.js';
import { PuenteLoRaMQTT } from './puente/puente-lora-mqtt.js';
import { MES } from './mes/mes.js';
import { Voceo } from './mes/voceo.js';
import { Ajustes } from './ajustes.js';
import { Mantenimiento } from './aseti/mantenimiento.js';
import { readFileSync } from 'node:fs';
import { Simulacion } from './sim/simulacion.js';
import { iniciarWeb } from './web/servidor.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const modoPrueba = args.includes('--prueba');
const duracionPrueba = Number(args.find((a) => /^\d+$/.test(a)) ?? 60);

const cfg = CONFIG;
if (modoPrueba && !process.env.VELOCIDAD) cfg.produccion.velocidad = 40;
// Con una placa real conectada el reloj va a tiempo real: la placa toma la hora del gateway
if (process.env.GATEWAY_SERIE && !process.env.VELOCIDAD) cfg.produccion.velocidad = 1;
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
// ID de nodo: línea × 100 + número de máquina (L2-INY-05 = 205); estaciones compartidas en el 900.
// Canal LoRa (gateway de 8 canales): uno por línea; MP, mezanina, PT y visión en el siguiente;
// las mesas de SM1, que escanean las bolsas de todas las líneas, se reparten en otros dos.
const lineas = cfg.produccion.lineas;
const canalComun = lineas.length + 1;
const base = (id, nombre, rssi, canalLoRa = canalComun) => ({ id, nombre, canal, canalLoRa, reloj, clave: claveNodo(cfg.claveRed, id), cfg: cfg.nodo, enlace: { rssi, snr: rssi > -100 ? 8 : 2 } });
const nodos = {
  inyectoras: lineas.flatMap((cuantas, l) => Array.from({ length: cuantas }, (_, i) => {
    const nombre = `L${l + 1}-INY-${String(i + 1).padStart(2, '0')}`;
    const n = new NodoInyectora({ ...base((l + 1) * 100 + i + 1, nombre, Math.round(azar(-108, -78)), l + 1), porCharola: cfg.produccion.bolsasPorCaja });
    n.linea = l + 1;
    return n;
  })),
  mp: new NodoAlmacenMP(base(901, 'MP-01', -95)),
  mez: new NodoMezanina(base(902, 'MEZ-01', -113)), // 2do piso: la señal más débil
  sm1: Array.from({ length: cfg.produccion.mesasSM1 }, (_, i) => new NodoSM1(base(911 + i, `SM1-${String(i + 1).padStart(2, '0')}`, -88 - (i % 3), canalComun + 1 + (i % 2)))), // mesas con pantalla AV
  pts: Array.from({ length: cfg.produccion.puestosPT }, (_, i) => new NodoAlmacenPT(base(921 + i, `PT-${String(i + 1).padStart(2, '0')}`, -98 + (i % 2) * 3))),
  vis: new NodoVision(base(931, 'VIS-01', -101)),
};
nodos.pt = nodos.pts[0]; // PT-01 también registra el ingreso a pre-envío (CP 13)
const lista = [...nodos.inyectoras, nodos.mp, nodos.mez, ...nodos.sm1, ...nodos.pts, nodos.vis];

// 4 · Puente LoRa ↔ MQTT
const puente = new PuenteLoRaMQTT({ canal, reloj, mqttUrl, prefijo: cfg.mqtt.prefijo, claveRed: cfg.claveRed, nodos: lista });
await puente.iniciar();

// 5 · MES central
const mes = new MES({ reloj, mqttUrl, prefijo: cfg.mqtt.prefijo, rutaBD: join(raiz, 'datos', 'trazabilidad.db'), rutaEsquema: join(raiz, 'sql', 'esquema.sql'), porCharola: cfg.produccion.bolsasPorCaja });
await mes.iniciar();

// 5b · Voceo por conmutador: textos y MP3 de la carpeta voceo/ (en Docker puede no estar: se vocea sin texto)
const dirVoceo = process.env.VOCEO_DIR || join(raiz, '..', 'voceo');
let avisos = null;
try {
  const { leerCatalogo, construirAvisos } = await import(pathToFileURL(join(dirVoceo, 'avisos.mjs')).href);
  avisos = construirAvisos(leerCatalogo(join(dirVoceo, 'catalogo.json')));
} catch {
  console.warn(`Voceo: no se encontró el catálogo en ${dirVoceo}; los avisos se publican sin texto.`);
}
// Ajustes del panel (colores del cliente, nombres, reglas del voceo): datos/ajustes.json
const ajustes = new Ajustes(join(raiz, 'datos', 'ajustes.json'), { roles: [...new Set((avisos ?? []).map((a) => a.rol).filter(Boolean))] });
const voceo = new Voceo({ reloj, mqttUrl, prefijo: cfg.mqtt.prefijo, avisos, ajustes: () => ajustes.get().voceo });
await voceo.iniciar();

// 6 · Escenarios (las personas en planta)
const sim = new Simulacion({ reloj, mes, canal, nodos, cfg: cfg.produccion });

// 6b · Placa real: GATEWAY_SERIE=COM9 conecta el gateway LoRa físico y TERMINAL_REAL (L1-INY-01) pasa a ser
// la terminal física. Esa máquina queda en modo manual y pide su primera OT sola.
if (process.env.GATEWAY_SERIE) {
  const { GatewaySerie } = await import('./radio/gateway-serie.js');
  const nombre = process.env.TERMINAL_REAL || 'L1-INY-01';
  const gemelo = nodos.inyectoras.find((n) => n.nombre === nombre);
  if (!gemelo) throw new Error(`TERMINAL_REAL=${nombre} no existe`);
  new GatewaySerie({ puerto: process.env.GATEWAY_SERIE, canal, puente, sim, gemelo, claveRed: cfg.claveRed, reloj, porCharola: cfg.produccion.bolsasPorCaja }).iniciar();
  sim.tomarControl(nombre);
  sim.pedirOT(nombre);
}

if (modoPrueba) {
  for (const f of ['resina', 'operador', 'peso', 'bolsaAjena', 'duplicada', 'sinCinta', 'camara', 'saltoCP10']) sim.inyectar(f);
  reloj.timeout(() => canal.cortarSenal(nodos.inyectoras[2].id, 15 * 60 * 1000), 5 * 60 * 1000);
  sim.iniciar();
  console.log(`Prueba: ${duracionPrueba} s reales a ${reloj.velocidad}x (≈ ${Math.round((duracionPrueba * reloj.velocidad) / 60)} min simulados)…`);
  setTimeout(() => {
    const r = mes.resumen();
    console.log('\nRadio:', { ...canal.stats, ocupacion: `${(canal.ocupacion() * 100).toFixed(1)} %` });
    console.log('Puente:', puente.stats);
    console.log('MES:', r.stats);
    console.log('Voceo:', voceo.stats);
    for (const v of voceo.historial.slice(0, 12).reverse()) console.log(`  [${v.estado}] ${v.codigo ?? ''} ${v.nodo ?? ''} → ${v.clave ?? '—'}${v.motivo ? ` (${v.motivo})` : ''}`);
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
  const { version } = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
  const mantenimiento = new Mantenimiento({ dirDatos: join(raiz, 'datos'), version, broker, reloj, canal, puente, mes, sim, nodos, voceo, ajustes, rutaBD: join(raiz, 'datos', 'trazabilidad.db') });
  const web = await iniciarWeb({ ajustes, mantenimiento, puerto: cfg.http.puerto, host: cfg.host, carpeta: join(raiz, 'public'), carpetaAudio: join(dirVoceo, 'salida'), voceo, mqttUrl, prefijo: cfg.mqtt.prefijo, reloj, canal, puente, mes, sim, nodos, cfg });
  sim.iniciar();
  console.log(`
  Simulador de trazabilidad ASETI
  ───────────────────────────────
  Panel:   http://localhost:${cfg.http.puerto}
  MQTT:    ${mqttUrl}   (tópicos ${cfg.mqtt.prefijo}/#)
  Base:    datos/trazabilidad.db
  Soporte: http://localhost:${cfg.http.puerto}/aseti.html  (clave en ASETI_TOKEN o datos/aseti-token.txt)
  Nodos:   ${lista.length} (${cfg.produccion.lineas.map((n, i) => `L${i + 1}: ${n}`).join(', ')} inyectoras + MP, mezanina, ${nodos.sm1.length} mesas SM1, ${nodos.pts.length} puestos PT, visión)
  Ctrl+C para salir.
`);
  const salir = () => {
    sim.detener();
    web.cerrar();
    voceo.cerrar();
    mes.cerrar();
    process.exit(0);
  };
  process.on('SIGINT', salir);
  process.on('SIGTERM', salir);
}
