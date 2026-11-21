// Servidor del panel: archivos estáticos, flujo SSE con el estado y API de control.
// El panel ve dos cosas: (1) lo que pasa por MQTT, igual que lo vería cualquier cliente real,
// y (2) una "vista de simulación" de las pantallas físicas de cada nodo y del aire LoRa.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import mqtt from 'mqtt';
import { FALLAS } from '../sim/catalogo.js';
import { CAMPOS, TIPO, FALLA_NOMBRE, CMD_NOMBRE } from '../protocolo/trama.js';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export async function iniciarWeb({ puerto, host, carpeta, mqttUrl, prefijo, reloj, canal, puente, mes, sim, nodos, cfg }) {
  const clientes = new Set();
  const enviar = (tipo, datos) => {
    const msg = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`;
    for (const res of clientes) res.write(msg);
  };

  // Todo lo que pasa por el broker
  const espia = mqtt.connect(mqttUrl, { clientId: 'panel-web' });
  espia.on('connect', () => espia.subscribe(`${prefijo}/#`));
  espia.on('message', (topico, payload) => {
    if (topico.endsWith('/gateway/traza')) return enviar('traza', JSON.parse(payload.toString()));
    let json;
    try {
      json = JSON.parse(payload.toString());
    } catch {
      json = payload.toString();
    }
    enviar('mqtt', { topico: topico.slice(prefijo.length + 1), json, ts: reloj.iso() });
  });
  canal.on('trama', (t) => enviar('aire', t));
  mes.on('evento', (ev) => ev.seq != null && enviar('mes', { nodo: ev.nodo, seq: ev.seq, cp: ev.cp, resultado: ev.resultado, codigo: ev.codigo, diferido: ev.diferido }));
  mes.on('duplicado', (ev) => enviar('mes', { nodo: ev.nodo, seq: ev.seq, cp: ev.cp, duplicado: true }));

  const todos = () => [...nodos.inyectoras, nodos.mp, nodos.mez, ...nodos.sm1, nodos.pt, nodos.vis];
  const estado = () => ({
    reloj: reloj.iso(),
    velocidad: reloj.velocidad,
    radio: { ...canal.stats, ocupacion: canal.ocupacion(), perdidaBase: canal.perdidaBase },
    puente: puente.stats,
    nodos: todos().map((n) => n.vista()),
    mes: mes.resumen(),
    bitacora: sim.bitacora.slice(0, 25),
    fallasPendientes: sim.fallas,
    intervaloBolsaMs: cfg.produccion.intervaloBolsaMs,
  });
  const timer = setInterval(() => clientes.size && enviar('estado', estado()), 800);

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`event: inicio\ndata: ${JSON.stringify({ prefijo, fallas: FALLAS, mqtt: mqttUrl, campos: CAMPOS, tipos: TIPO, fallasCodigo: FALLA_NOMBRE, cmds: CMD_NOMBRE })}\n\n`);
        res.write(`event: estado\ndata: ${JSON.stringify(estado())}\n\n`);
        clientes.add(res);
        req.on('close', () => clientes.delete(res));
        return;
      }
      if (url.pathname === '/api/genealogia') {
        const g = mes.genealogia(url.searchParams.get('id'));
        return json(res, g ? 200 : 404, g ?? { error: 'No se encontró ese código' });
      }
      if (url.pathname === '/api/manual/etiquetas') {
        const e = sim.etiquetas(url.searchParams.get('maquina'));
        return json(res, e ? 200 : 404, e ?? { error: 'No existe esa inyectora' });
      }
      if (url.pathname === '/api/manual' && req.method === 'POST') {
        const c = JSON.parse((await leerCuerpo(req)) || '{}');
        const acciones = {
          tomar: () => sim.tomarControl(c.maquina),
          soltar: () => sim.soltarControl(c.maquina),
          pedirOT: () => sim.pedirOT(c.maquina),
          escanear: () => sim.escanearManual(c.maquina, c.codigo),
          desbloquear: () => sim.desbloquearManual(c.maquina),
          pesar: () => sim.pesarManual(c.maquina, Number(c.gramos)),
        };
        const f = acciones[c.accion];
        return json(res, f ? 200 : 400, f ? f() : { ok: false, mensaje: 'acción desconocida' });
      }
      if (url.pathname === '/api/control' && req.method === 'POST') {
        const cuerpo = JSON.parse((await leerCuerpo(req)) || '{}');
        return json(res, 200, controlar(cuerpo));
      }
      // estáticos
      const ruta = url.pathname === '/' ? '/index.html' : url.pathname;
      const archivo = normalize(join(carpeta, ruta));
      if (!archivo.startsWith(normalize(carpeta))) return json(res, 403, { error: 'prohibido' });
      const contenido = await readFile(archivo);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(contenido);
    } catch (e) {
      if (e.code === 'ENOENT') return json(res, 404, { error: 'no encontrado' });
      json(res, 500, { error: e.message });
    }
  });

  function controlar(c) {
    switch (c.accion) {
      case 'velocidad':
        reloj.setVelocidad(Number(c.valor));
        return { ok: true, velocidad: reloj.velocidad };
      case 'perdida':
        canal.perdidaBase = Math.max(0, Math.min(0.9, Number(c.valor)));
        return { ok: true };
      case 'intervalo':
        cfg.produccion.intervaloBolsaMs = Math.max(5000, Number(c.valor));
        return { ok: true };
      case 'falla':
        return { ok: sim.inyectar(c.tipo, c.maquina || null) };
      case 'sinSenal': {
        const n = todos().find((x) => x.nombre === c.nodo);
        if (!n) return { ok: false };
        canal.cortarSenal(n.id, Number(c.segundos || 300) * 1000);
        sim.log(`${n.nombre} sin señal LoRa por ${c.segundos || 300} s (simulados)`);
        return { ok: true };
      }
      case 'conSenal': {
        const n = todos().find((x) => x.nombre === c.nodo);
        if (!n) return { ok: false };
        canal.sinSenal.delete(n.id);
        sim.log(`${n.nombre} recupera la señal LoRa`);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'acción desconocida' };
    }
  }

  await new Promise((ok, mal) => {
    servidor.once('error', mal);
    servidor.listen(puerto, host, ok);
  });
  return { cerrar: () => (clearInterval(timer), espia.end(true), servidor.close()) };
}

function json(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function leerCuerpo(req) {
  return new Promise((ok) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => ok(d));
  });
}
