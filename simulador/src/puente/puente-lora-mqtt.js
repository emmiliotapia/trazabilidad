// Puente LoRa ↔ MQTT (corre en el servidor junto al gateway).
//
//  Subida:  trama binaria → verifica firma → JSON → publica en MQTT (QoS 1) → ACK por radio al nodo
//  Bajada:  MQTT .../nodo/{nombre}/cmd (JSON) → trama CMD → radio → espera CMD_ACK (con reintentos)
//
// Este módulo es el que se reutiliza tal cual con hardware real: solo cambia el "canal"
// (radio simulada hoy, puerto serie del gateway Heltec mañana).
import mqtt from 'mqtt';
import { codificar, decodificar, leerCabecera, claveNodo, hex, TIPO, FALLA, FALLA_NOMBRE, CMD, CMD_NOMBRE } from '../protocolo/trama.js';

export class PuenteLoRaMQTT {
  constructor({ canal, reloj, mqttUrl, prefijo, claveRed, nodos }) {
    Object.assign(this, { canal, reloj, mqttUrl, prefijo, claveRed });
    this.porId = new Map(nodos.map((n) => [n.id, n.nombre]));
    this.porNombre = new Map(nodos.map((n) => [n.nombre, n.id]));
    this.claves = new Map(nodos.map((n) => [n.id, claveNodo(claveRed, n.id)]));
    this.seqCmd = new Map();
    this.pendientes = new Map(); // `${nodoId}:${seq}` → { id, trama, intentos, timer }
    this.stats = { subidas: 0, rechazadas: 0, publicadas: 0, acks: 0, comandos: 0, cmdSinRespuesta: 0 };
  }

  async iniciar() {
    this.cliente = mqtt.connect(this.mqttUrl, { clientId: 'puente-lora-mqtt', clean: true });
    await new Promise((ok, mal) => {
      this.cliente.once('connect', ok);
      this.cliente.once('error', mal);
    });
    await this.cliente.subscribeAsync(`${this.prefijo}/nodo/+/cmd`, { qos: 1 });
    this.cliente.on('message', (topico, payload) => this.alRecibirMQTT(topico, payload));
    this.canal.registrarGateway(this);
  }

  ts() {
    return Math.floor(this.reloj.ahora() / 1000);
  }

  publicar(topico, obj, opciones = { qos: 1 }) {
    return this.cliente.publishAsync(topico, JSON.stringify(obj), opciones);
  }

  traza(dir, buf, topico, json) {
    this.cliente.publish(`${this.prefijo}/gateway/traza`, JSON.stringify({ ts: this.reloj.iso(), dir, bytes: buf.length, hex: hex(buf), topico, json }));
  }

  // ───────────── subida: radio → MQTT ─────────────
  async recibir(buf, meta) {
    this.stats.subidas++;
    const cab = leerCabecera(buf);
    const nombre = cab && this.porId.get(cab.nodo);
    if (!nombre) return this.rechazar(buf, 'NODO_DESCONOCIDO');
    const m = decodificar(buf, this.claves.get(cab.nodo));
    if (!m.ok) return this.rechazar(buf, m.error);

    const base = `${this.prefijo}/nodo/${nombre}`;
    const tsGw = this.ts();

    if (m.tipo === TIPO.EVENTO) {
      const json = {
        nodo: nombre,
        nodo_id: m.nodo,
        seq: m.seq,
        cp: m.cp,
        resultado: m.resultado === FALLA.PASS ? 'PASS' : 'FAIL',
        codigo: FALLA_NOMBRE[m.resultado] ?? `DESCONOCIDO_${m.resultado}`,
        ts_nodo: new Date(m.ts * 1000).toISOString(),
        ts_gateway: new Date(tsGw * 1000).toISOString(),
        diferido: tsGw - m.ts > 15, // salió del búfer después de una desconexión
        rssi: meta.rssi,
        snr: meta.snr,
        datos: m.datos,
      };
      await this.publicar(`${base}/evento`, json);
      this.stats.publicadas++;
      this.traza('subida', buf, `${base}/evento`, json);
      // ACK al nodo solo después de que el broker confirmó la publicación (QoS 1)
      const ack = codificar({ tipo: TIPO.ACK, nodo: m.nodo, seq: 0, seqAck: m.seq, ts: this.ts() }, this.claves.get(m.nodo));
      this.reloj.timeout(() => {
        this.canal.transmitir('gw', ack, m.nodo);
        this.stats.acks++;
      }, 40);
      return;
    }

    if (m.tipo === TIPO.ESTADO) {
      const json = { nodo: nombre, ts_nodo: new Date(m.ts * 1000).toISOString(), ts_gateway: new Date(tsGw * 1000).toISOString(), bufer: m.bufer, bloqueado: m.bloqueado, rssi: meta.rssi, snr: meta.snr, datos: m.datos };
      await this.publicar(`${base}/estado`, json, { qos: 0, retain: true });
      this.traza('subida', buf, `${base}/estado`, json);
      return;
    }

    if (m.tipo === TIPO.CMD_ACK) {
      const clave = `${m.nodo}:${m.seqCmd}`;
      const p = this.pendientes.get(clave);
      if (!p) return; // ACK repetido
      clearTimeout(p.timer);
      this.pendientes.delete(clave);
      const json = { id: p.id, nodo: nombre, cmd: p.cmd, seq: m.seqCmd, resultado: FALLA_NOMBRE[m.resultado] ?? m.resultado, intentos: p.intentos };
      await this.publicar(`${base}/cmd_ack`, json);
      this.traza('subida', buf, `${base}/cmd_ack`, json);
    }
  }

  rechazar(buf, motivo) {
    this.stats.rechazadas++;
    this.cliente.publish(`${this.prefijo}/gateway/rechazo`, JSON.stringify({ ts: this.reloj.iso(), motivo, hex: hex(buf) }));
  }

  // ───────────── bajada: MQTT → radio ─────────────
  alRecibirMQTT(topico, payload) {
    const nombre = topico.split('/').at(-2);
    const nodoId = this.porNombre.get(nombre);
    if (nodoId === undefined) return;
    let msg;
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    const codigo = CMD[msg.cmd];
    if (!codigo) return;
    const seq = ((this.seqCmd.get(nodoId) ?? 0) + 1) & 0xffff;
    this.seqCmd.set(nodoId, seq);
    const trama = codificar({ tipo: TIPO.CMD, nodo: nodoId, seq, codigo, datos: msg.datos }, this.claves.get(nodoId));
    const p = { id: msg.id, cmd: CMD_NOMBRE[codigo], trama, intentos: 0, nodoId, nombre, seq };
    this.pendientes.set(`${nodoId}:${seq}`, p);
    this.stats.comandos++;
    this.traza('bajada', trama, topico, msg);
    this.enviarCmd(p);
  }

  enviarCmd(p) {
    p.intentos++;
    this.canal.transmitir('gw', p.trama, p.nodoId);
    p.timer = this.reloj.timeout(() => {
      if (!this.pendientes.has(`${p.nodoId}:${p.seq}`)) return;
      if (p.intentos < 5) return this.enviarCmd(p);
      this.pendientes.delete(`${p.nodoId}:${p.seq}`);
      this.stats.cmdSinRespuesta++;
      this.publicar(`${this.prefijo}/nodo/${p.nombre}/cmd_ack`, { id: p.id, nodo: p.nombre, cmd: p.cmd, seq: p.seq, resultado: 'SIN_RESPUESTA', intentos: p.intentos });
    }, 3000 + Math.random() * 1500);
  }
}
