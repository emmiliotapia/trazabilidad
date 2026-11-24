// Voceo por conmutador: decide qué alertas del MES se anuncian por altavoz y a quién se llama.
// Escucha MQTT como cualquier cliente (alertas, eventos y respuestas de comandos) y publica en
// `{prefijo}/voceo` el aviso que el servidor del conmutador debe reproducir en los Fanvil.
//
// Reglas (los tiempos y qué código llama a quién se cambian en el panel, pestaña Configuración):
//  1. Solo se vocean los códigos que tienen rol asignado; el resto se queda en el panel.
//  2. No se vocea una alerta que llegó atrasada (evento guardado en el búfer de la terminal) más de maxAtrasoMin.
//  3. El mismo llamado (rol + destino) no se repite antes de silencioMin.
//  4. Si una máquina sigue bloqueada después de escalarMin, se vuelve a vocear (hasta maxEscalamientos veces).
//     El bloqueo se da por resuelto cuando la terminal confirma DESBLOQUEAR o cuando el arranque (CP 06) pasa.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';

const MIN = 60 * 1000;
const AJUSTES_FIJOS = { activo: true, repetir: 2, maxAtrasoMin: 2, silencioMin: 5, escalarMin: 5, maxEscalamientos: 2, reglas: null };

// Valores de fábrica: código de la alerta → a quién se llama. `bloqueo` = la terminal queda bloqueada hasta que la libere el supervisor.
export const REGLAS = {
  OPERADOR_NO_HABILITADO: { rol: 'supervisor', bloqueo: true },
  QR_MAQUINA_INCORRECTO: { rol: 'supervisor', bloqueo: true },
  OT_NO_ASIGNADA: { rol: 'supervisor', bloqueo: true },
  NODO_BLOQUEADO: { rol: 'supervisor', bloqueo: true },
  DEFECTO_CRITICO: { rol: 'calidad' },
  CERTIFICADO_INVALIDO: { rol: 'calidad' },
  RESINA_INCORRECTA: { rol: 'supervisor' },
  GATE_PREVIO_NO_PASS: { rol: 'supervisor' },
  BOLSA_OTRA_OT: { rol: 'calidad' },
  DUPLICADO: { rol: 'calidad' },
  SKU_NO_COINCIDE: { rol: 'supervisor' },
  TARIMA_INCOMPLETA: { rol: 'supervisor' },
};

// Nodos que no tienen aviso propio: se llama al lugar donde están
const LUGAR = { 'VIS-01': 'EMB-01' };

export class Voceo extends EventEmitter {
  // avisos: lista de voceo/avisos.mjs (o null si no está la carpeta voceo: entonces se publica sin texto)
  // ajustes: función que devuelve los ajustes vigentes del voceo (ver src/ajustes.js)
  constructor({ reloj, mqttUrl, prefijo, avisos, ajustes = () => AJUSTES_FIJOS }) {
    super();
    Object.assign(this, { reloj, mqttUrl, prefijo });
    this.ajustes = ajustes;
    this.avisos = avisos ? new Map(avisos.map((a) => [a.clave, a])) : null;
    this.ultimo = new Map(); // clave → ms del último voceo
    this.abiertos = new Map(); // nodo → bloqueo sin resolver
    this.historial = [];
    this.stats = { voceados: 0, omitidos: 0, escalados: 0 };
  }

  async iniciar() {
    this.cliente = mqtt.connect(this.mqttUrl, { clientId: 'mes-voceo' });
    await new Promise((ok) => this.cliente.once('connect', ok));
    const p = this.prefijo;
    this.cliente.subscribe([`${p}/alerta`, `${p}/nodo/+/evento`, `${p}/nodo/+/cmd_ack`], { qos: 1 });
    this.cliente.on('message', (topico, payload) => {
      let m;
      try {
        m = JSON.parse(payload.toString());
      } catch {
        return;
      }
      if (topico === `${p}/alerta`) this.alAlerta(m);
      else if (topico.endsWith('/cmd_ack') && m.cmd === 'DESBLOQUEAR' && m.resultado === 'PASS') this.resolver(m.nodo, 'terminal desbloqueada');
      else if (topico.endsWith('/evento') && m.cp === 6 && m.resultado === 'PASS') this.resolver(m.nodo, 'arranque correcto');
    });
  }

  alAlerta(a) {
    const cfg = this.ajustes();
    const rol = cfg.reglas ? cfg.reglas[a.codigo] : REGLAS[a.codigo]?.rol;
    if (!rol) return this.omitir(a, null, 'no se vocea, solo panel');
    if (!cfg.activo) return this.omitir(a, null, 'voceo apagado en Configuración');
    const regla = { rol, bloqueo: !!REGLAS[a.codigo]?.bloqueo };
    const destino = LUGAR[a.nodo] ?? a.nodo;
    const clave = `${regla.rol}__${destino}`;
    if (this.avisos && !this.avisos.has(clave)) return this.omitir(a, clave, 'no hay aviso grabado para ese rol y lugar');

    const ahora = this.reloj.ahora();
    const tsEvento = Date.parse(a.ts_evento ?? a.ts);
    if (a.diferido && ahora - tsEvento > cfg.maxAtrasoMin * MIN) return this.omitir(a, clave, `llegó con ${Math.round((ahora - tsEvento) / MIN)} min de atraso`);
    if (ahora - (this.ultimo.get(clave) ?? -Infinity) < cfg.silencioMin * MIN) return this.omitir(a, clave, `ya se voceó hace menos de ${cfg.silencioMin} min`);

    this.vocear(clave, a, 0);
    if (regla.bloqueo && a.cp === 6 && cfg.maxEscalamientos > 0 && !this.abiertos.has(a.nodo)) {
      const b = { clave, alerta: a, desde: ahora, escalamientos: 0 };
      this.abiertos.set(a.nodo, b);
      this.programarEscalamiento(a.nodo, b);
    }
  }

  programarEscalamiento(nodo, b) {
    b.timer = this.reloj.timeout(() => {
      if (this.abiertos.get(nodo) !== b) return;
      b.escalamientos++;
      this.stats.escalados++;
      this.vocear(b.clave, b.alerta, b.escalamientos);
      if (b.escalamientos < this.ajustes().maxEscalamientos) this.programarEscalamiento(nodo, b);
      else this.abiertos.delete(nodo);
    }, this.ajustes().escalarMin * MIN);
  }

  resolver(nodo, motivo) {
    const b = this.abiertos.get(nodo);
    if (!b) return;
    clearTimeout(b.timer);
    this.abiertos.delete(nodo);
    this.anotar({ estado: 'resuelto', clave: b.clave, alerta: b.alerta, motivo: `${motivo} a los ${Math.max(1, Math.round((this.reloj.ahora() - b.desde) / MIN))} min` });
  }

  // Publica un aviso. También lo usa el panel para probar el conmutador sin provocar una falla.
  vocear(clave, alerta = null, escalamiento = 0) {
    const aviso = this.avisos?.get(clave);
    const [rol, destino] = clave.split('__');
    const msg = {
      id: randomUUID(),
      ts: this.reloj.iso(),
      rol: aviso?.tipo === 'general' ? null : rol,
      destino: aviso?.tipo === 'general' ? null : destino,
      general: aviso?.tipo === 'general' ? destino : undefined,
      archivo: `${clave}.mp3`,
      texto: aviso?.texto ?? null,
      repetir: this.ajustes().repetir,
      escalamiento,
      alerta: alerta ? { codigo: alerta.codigo, cp: alerta.cp, nodo: alerta.nodo, ot: alerta.ot ?? null, nivel: alerta.nivel } : null,
    };
    this.ultimo.set(clave, this.reloj.ahora());
    this.cliente.publish(`${this.prefijo}/voceo`, JSON.stringify(msg), { qos: 1 });
    this.stats.voceados++;
    this.anotar({ estado: 'voceado', clave, alerta, texto: msg.texto, escalamiento, motivo: escalamiento ? `sigue bloqueada (aviso ${escalamiento + 1})` : null });
    return msg;
  }

  omitir(alerta, clave, motivo) {
    this.stats.omitidos++;
    this.anotar({ estado: 'omitido', clave, alerta, motivo });
  }

  anotar({ estado, clave, alerta, texto = null, escalamiento = 0, motivo = null }) {
    const r = { ts: this.reloj.iso(), estado, clave, archivo: clave ? `${clave}.mp3` : null, texto: texto ?? this.avisos?.get(clave)?.texto ?? null, escalamiento, motivo, codigo: alerta?.codigo ?? null, cp: alerta?.cp ?? null, nodo: alerta?.nodo ?? null };
    this.historial.unshift(r);
    this.historial.length = Math.min(this.historial.length, 40);
    this.emit('registro', r);
  }

  // Avisos que el panel puede probar a mano
  catalogo() {
    return this.avisos ? [...this.avisos.values()].map(({ clave, tipo, rol, destino, texto }) => ({ clave, tipo, rol, destino, texto })) : [];
  }

  cerrar() {
    for (const b of this.abiertos.values()) clearTimeout(b.timer);
    this.cliente?.end(true);
  }
}
