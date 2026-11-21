// Nodo base: reproduce lo que haría el firmware del ESP32.
//  - Valida el gate localmente (en las subclases) y responde al instante.
//  - Numera cada evento (seq) y espera ACK del gateway.
//  - Reintenta con espera aleatoria; si no hay enlace, guarda en búfer (store and forward).
//  - Sincroniza su reloj con la hora que viene en cada ACK.
//  - Atiende comandos (cargar OT, desbloquear...) y responde CMD_ACK.
import { codificar, decodificar, TIPO, FALLA, FALLA_NOMBRE, FALLA_TEXTO } from '../protocolo/trama.js';
import { azar } from '../reloj.js';

export class Nodo {
  constructor({ id, nombre, tipo, canal, reloj, clave, cfg, enlace }) {
    Object.assign(this, { id, nombre, tipo, canal, reloj, clave, cfg });
    this.enlace = enlace;
    this.seq = 0;
    this.cola = []; // eventos pendientes de ACK (en flash)
    this.enVuelo = null;
    this.conEnlace = true;
    this.offsetReloj = Math.round(azar(-8000, 8000)); // deriva inicial del RTC
    this.ultimoCmd = new Set();
    this.pantalla = { l1: nombre, l2: 'Iniciando', color: 'gris' };
    this.stats = { eventos: 0, reintentos: 0, acks: 0, descartados: 0, pass: 0, fail: 0 };
    this.ultimoEvento = null;
    canal.registrarNodo(this, enlace);
    this.reloj.timeout(() => this.latido(), azar(2000, this.cfg.latidoMs));
  }

  hora() {
    return Math.floor((this.reloj.ahora() + this.offsetReloj) / 1000);
  }

  siguienteSeq() {
    this.seq = (this.seq + 1) & 0xffff;
    return this.seq;
  }

  mostrar(l1, l2, color) {
    this.pantalla = { l1, l2, color };
  }

  // ---- envío de eventos con ACK ----
  emitir(cp, codigo, datos) {
    const seq = this.siguienteSeq();
    const trama = codificar({ tipo: TIPO.EVENTO, nodo: this.id, seq, cp, resultado: codigo, ts: this.hora(), datos }, this.clave);
    this.cola.push({ seq, trama, cp, intentos: 0 });
    if (this.cola.length > this.cfg.capacidadBufer) {
      this.cola.splice(this.enVuelo ? 1 : 0, 1);
      this.stats.descartados++;
    }
    this.stats.eventos++;
    if (codigo === FALLA.PASS) this.stats.pass++;
    else this.stats.fail++;
    this.ultimoEvento = { cp, resultado: FALLA_NOMBRE[codigo], ts: this.reloj.iso() };
    this.bombear();
    return { ok: codigo === FALLA.PASS, codigo: FALLA_NOMBRE[codigo], texto: FALLA_TEXTO[FALLA_NOMBRE[codigo]], seq, cp, bytes: trama.length };
  }

  bombear() {
    if (this.enVuelo || this.cola.length === 0) return;
    const item = this.cola[0];
    this.enVuelo = item;
    item.intentos++;
    // espera aleatoria antes de transmitir para no chocar con otros nodos
    this.reloj.timeout(() => {
      if (this.enVuelo !== item) return;
      this.canal.transmitir(this.id, item.trama);
      this.timerAck = this.reloj.timeout(() => this.sinAck(item), this.cfg.esperaAckMs);
    }, azar(20, 400));
  }

  sinAck(item) {
    if (this.enVuelo !== item) return;
    this.enVuelo = null;
    this.stats.reintentos++;
    if (item.intentos >= this.cfg.maxIntentos) {
      this.conEnlace = false;
      item.intentos = 0;
      this.reloj.timeout(() => this.bombear(), this.cfg.reintentoLargoMs * azar(0.8, 1.2));
    } else {
      this.reloj.timeout(() => this.bombear(), azar(300, 1500) * item.intentos);
    }
  }

  // ---- recepción (bajada) ----
  recibir(buf) {
    const m = decodificar(buf, this.clave);
    if (!m.ok || m.nodo !== this.id) return;

    if (m.tipo === TIPO.ACK) {
      if (this.enVuelo && m.seqAck === this.enVuelo.seq) {
        clearTimeout(this.timerAck);
        this.cola.shift();
        this.enVuelo = null;
        this.conEnlace = true;
        this.stats.acks++;
        this.offsetReloj = m.ts * 1000 - this.reloj.ahora(); // sincroniza el RTC con el gateway
        this.reloj.timeout(() => this.bombear(), azar(50, 250));
      }
      return;
    }

    if (m.tipo === TIPO.CMD) {
      let resultado = FALLA.PASS;
      if (!this.ultimoCmd.has(m.seq)) {
        // idempotente: si el CMD_ACK se perdió y el gateway reintenta, no se ejecuta dos veces
        this.ultimoCmd.add(m.seq);
        if (this.ultimoCmd.size > 50) this.ultimoCmd.delete(this.ultimoCmd.values().next().value);
        resultado = this.manejarComando(m.codigo, m.datos) ?? FALLA.PASS;
      }
      const ack = codificar({ tipo: TIPO.CMD_ACK, nodo: this.id, seq: this.siguienteSeq(), seqCmd: m.seq, resultado }, this.clave);
      this.reloj.timeout(() => this.canal.transmitir(this.id, ack), azar(30, 150));
    }
  }

  manejarComando() {
    return FALLA.PASS;
  }

  // ---- latido de estado (sin ACK) ----
  latido() {
    const trama = codificar(
      { tipo: TIPO.ESTADO, nodo: this.id, seq: this.siguienteSeq(), ts: this.hora(), bufer: this.cola.length, bloqueado: !!this.bloqueado, datos: this.datosEstado() },
      this.clave,
    );
    this.canal.transmitir(this.id, trama);
    this.reloj.timeout(() => this.latido(), this.cfg.latidoMs * azar(0.9, 1.1));
  }

  datosEstado() {
    return {};
  }

  // Vista para el panel (solo simulación: en planta esto se ve en la pantalla física)
  vista() {
    return {
      id: this.id,
      nombre: this.nombre,
      tipo: this.tipo,
      pantalla: this.pantalla,
      bufer: this.cola.length,
      conEnlace: this.conEnlace,
      sinSenal: !this.canal.tieneSenal(this.id),
      rssi: this.enlace.rssi,
      bloqueado: !!this.bloqueado,
      stats: this.stats,
      ultimoEvento: this.ultimoEvento,
    };
  }
}
