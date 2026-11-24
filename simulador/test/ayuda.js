// Herramientas compartidas por las pruebas.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Reloj } from '../src/reloj.js';
import { claveNodo } from '../src/protocolo/trama.js';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ESQUEMA = join(RAIZ, 'sql', 'esquema.sql');
export const MIN = 60 * 1000;

export const carpetaTemporal = () => mkdtempSync(join(tmpdir(), 'aseti-prueba-'));

// Reloj manual: el tiempo solo avanza con avanzar(ms) y los timeouts se disparan en orden.
export function relojFalso(inicio = Date.UTC(2026, 10, 24, 12, 0, 0)) {
  let t = inicio;
  let pendientes = [];
  return {
    ahora: () => t,
    iso: (ms = t) => new Date(ms).toISOString(),
    timeout(fn, ms) {
      const x = { en: t + ms, fn };
      pendientes.push(x);
      return x;
    },
    esperar(ms) {
      return new Promise((ok) => this.timeout(ok, ms));
    },
    avanzar(ms) {
      const meta = t + ms;
      for (;;) {
        pendientes.sort((a, b) => a.en - b.en);
        const x = pendientes[0];
        if (!x || x.en > meta) break;
        pendientes.shift();
        t = x.en;
        x.fn();
      }
      t = meta;
    },
    cancelar: (x) => (pendientes = pendientes.filter((p) => p !== x)),
  };
}

// Reloj real acelerado cuyos timers no mantienen vivo el proceso (para la prueba de punta a punta).
export class RelojPrueba extends Reloj {
  timeout(fn, ms) {
    const t = super.timeout(fn, ms);
    t.unref?.();
    return t;
  }
}

// Radio que no transmite: guarda lo que el nodo manda.
export function canalFalso() {
  return {
    enviadas: [],
    registrarNodo() {},
    transmitir(id, trama) {
      this.enviadas.push({ id, trama });
    },
    tieneSenal: () => true,
  };
}

export const CFG_NODO = { esperaAckMs: 2500, maxIntentos: 4, reintentoLargoMs: 20000, capacidadBufer: 500, latidoMs: 120000 };
export const CLAVE_RED = 'clave-de-prueba';

// Crea una terminal de la clase dada con radio y reloj falsos.
export function crearNodo(Clase, { id = 107, nombre = 'L1-INY-07', reloj = relojFalso(), canal = canalFalso(), ...extra } = {}) {
  return new Clase({ id, nombre, canal, canalLoRa: 1, reloj, clave: claveNodo(CLAVE_RED, id), cfg: CFG_NODO, enlace: { rssi: -90, snr: 8 }, porCharola: 4, ...extra });
}

// Evento como lo publica el puente en MQTT
export function evento({ nodo = 'L1-INY-07', seq = 1, cp, resultado = 'PASS', codigo = resultado === 'PASS' ? 'PASS' : 'FALLA', datos = {}, ts = '2026-11-24T12:00:00.000Z', diferido = false }) {
  return { nodo, nodo_id: 107, seq, cp, resultado, codigo, ts_nodo: ts, ts_gateway: ts, diferido, rssi: -90, snr: 8, datos };
}
