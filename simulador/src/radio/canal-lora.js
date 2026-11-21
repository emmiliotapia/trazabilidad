// Canal LoRa simulado (un solo canal, sin "capture effect").
// Reemplazo real: la radio SX127x/SX126x del nodo y del gateway. El puente solo usa
// registrarGateway() y transmitir('gw', ...), así que cambiar este archivo por un
// lector de puerto serie del gateway Heltec no toca el resto del sistema.
import { EventEmitter } from 'node:events';
import { leerCabecera, TIPO_NOMBRE, hex } from '../protocolo/trama.js';

// Tiempo en aire según la fórmula de Semtech (AN1200.13)
export function tiempoEnAire(bytes, { sf, bw, cr, preambulo }) {
  const tSym = (2 ** sf / bw) * 1000;
  const de = tSym > 16 ? 1 : 0; // optimización de baja tasa
  const h = 0; // cabecera explícita
  const crc = 1;
  const num = 8 * bytes - 4 * sf + 28 + 16 * crc - 20 * h;
  const simbolosPayload = 8 + Math.max(Math.ceil(num / (4 * (sf - 2 * de))) * (cr + 4), 0);
  return (preambulo + 4.25) * tSym + simbolosPayload * tSym;
}

export class CanalLoRa extends EventEmitter {
  constructor(reloj, cfg) {
    super();
    this.reloj = reloj;
    this.cfg = cfg;
    this.perdidaBase = cfg.perdidaBase;
    this.activas = [];
    this.nodos = new Map();
    this.enlaces = new Map();
    this.gateway = null;
    this.sinSenal = new Map(); // nodoId → hasta (ms simulados)
    this.aire = []; // [fin, ms] para calcular ocupación del canal
    this.stats = { tramas: 0, ok: 0, colisiones: 0, perdidas: 0, sinSenal: 0, bytes: 0, subida: 0, bajada: 0 };
  }

  registrarNodo(nodo, enlace) {
    this.nodos.set(nodo.id, nodo);
    this.enlaces.set(nodo.id, enlace);
  }

  registrarGateway(gw) {
    this.gateway = gw;
  }

  cortarSenal(nodoId, ms) {
    this.sinSenal.set(nodoId, this.reloj.ahora() + ms);
  }

  tieneSenal(nodoId) {
    const hasta = this.sinSenal.get(nodoId);
    if (!hasta) return true;
    if (this.reloj.ahora() > hasta) {
      this.sinSenal.delete(nodoId);
      return true;
    }
    return false;
  }

  transmitir(origen, buf, destino) {
    const ahora = this.reloj.ahora();
    const ms = tiempoEnAire(buf.length, this.cfg);
    const tx = { origen, destino, buf, inicio: ahora, fin: ahora + ms, ms, colision: false };
    for (const otra of this.activas) {
      if (otra.fin > ahora) {
        otra.colision = true;
        tx.colision = true;
      }
    }
    this.activas.push(tx);
    this.aire.push([tx.fin, ms]);
    this.stats.tramas++;
    this.stats.bytes += buf.length;
    this.reloj.timeout(() => this.finalizar(tx), ms);
  }

  probPerdida(enlace) {
    // Más pérdida cuando la señal está cerca del límite de sensibilidad (SF7 ≈ -123 dBm)
    const margen = enlace.rssi + 123;
    const extra = margen < 10 ? (10 - margen) * 0.03 : 0;
    return Math.min(0.9, this.perdidaBase + extra);
  }

  finalizar(tx) {
    this.activas = this.activas.filter((t) => t !== tx);
    const subida = tx.origen !== 'gw';
    const nodoId = subida ? tx.origen : tx.destino;
    const enlace = this.enlaces.get(nodoId) || { rssi: -100, snr: 5 };
    const rssi = Math.round(enlace.rssi + (Math.random() * 6 - 3));
    const snr = Math.round((enlace.snr + (Math.random() * 2 - 1)) * 10) / 10;

    let estado = 'ok';
    if (tx.colision) estado = 'colision';
    else if (!this.tieneSenal(nodoId)) estado = 'sin_senal';
    else if (Math.random() < this.probPerdida(enlace)) estado = 'perdida';

    if (estado === 'ok') this.stats.ok++;
    else if (estado === 'colision') this.stats.colisiones++;
    else if (estado === 'sin_senal') this.stats.sinSenal++;
    else this.stats.perdidas++;
    if (subida) this.stats.subida++;
    else this.stats.bajada++;

    const cab = leerCabecera(tx.buf);
    this.emit('trama', {
      ts: this.reloj.iso(tx.fin),
      dir: subida ? 'subida' : 'bajada',
      nodo: this.nodos.get(nodoId)?.nombre ?? String(nodoId),
      tipo: TIPO_NOMBRE[cab?.tipo] ?? '?',
      seq: cab?.seq,
      seqAck: cab?.tipo === 3 && tx.buf.length >= 11 ? tx.buf.readUInt16BE(5) : undefined,
      bytes: tx.buf.length,
      airtimeMs: Math.round(tx.ms * 10) / 10,
      hex: hex(tx.buf),
      estado,
      rssi,
      snr,
    });

    if (estado !== 'ok') return;
    if (subida) this.gateway?.recibir(tx.buf, { rssi, snr });
    else this.nodos.get(tx.destino)?.recibir(tx.buf, { rssi, snr });
  }

  // Porcentaje del último minuto (simulado) en que el canal estuvo ocupado
  ocupacion() {
    const ahora = this.reloj.ahora();
    this.aire = this.aire.filter(([fin]) => fin > ahora - 60000);
    const ms = this.aire.reduce((s, [, m]) => s + m, 0);
    return Math.min(1, ms / 60000);
  }
}
