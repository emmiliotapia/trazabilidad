// Mantenimiento ASETI: diagnóstico rápido y acciones de mantenimiento para el equipo de soporte.
//
// Seguridad:
//  - Todo pide la clave de mantenimiento (variable ASETI_TOKEN; si no existe se crea una en datos/aseti-token.txt).
//  - Solo se pueden correr las acciones de ACCIONES (una lista fija). No hay forma de ejecutar comandos
//    arbitrarios del sistema: una página web que corre cualquier comando es la misma puerta que usaría un intruso.
//  - Después de 5 claves equivocadas en un minuto desde la misma IP, se bloquea esa IP 1 minuto.
//  - Cada acción queda en datos/auditoria.log (fecha, IP, acción, resultado).
//
// Para agregar un "script" de mantenimiento: añada una entrada en ACCIONES con su texto y su función.
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const ERRORES = []; // últimos errores y avisos del proceso
for (const nivel of ['error', 'warn']) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args) => {
    ERRORES.unshift({ ts: new Date().toISOString(), nivel, texto: args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 600) });
    ERRORES.length = Math.min(ERRORES.length, 50);
    original(...args);
  };
}
process.on('unhandledRejection', (e) => console.error('Promesa sin atender:', e));

export class Mantenimiento {
  constructor({ dirDatos, version, broker, reloj, canal, puente, mes, sim, nodos, voceo, ajustes, rutaBD }) {
    Object.assign(this, { dirDatos, version, broker, reloj, canal, puente, mes, sim, nodos, voceo, ajustes, rutaBD });
    this.inicio = Date.now();
    this.intentos = new Map(); // ip → { n, desde, bloqueadaHasta }
    this.rutaAuditoria = join(dirDatos, 'auditoria.log');
    this.token = this.cargarToken();
  }

  cargarToken() {
    if (process.env.ASETI_TOKEN) return process.env.ASETI_TOKEN;
    const ruta = join(this.dirDatos, 'aseti-token.txt');
    if (existsSync(ruta)) return readFileSync(ruta, 'utf8').trim();
    mkdirSync(this.dirDatos, { recursive: true });
    const t = randomBytes(18).toString('base64url');
    writeFileSync(ruta, `${t}\n`, { mode: 0o600 });
    console.log(`  Mantenimiento ASETI: se creó la clave en ${ruta}`);
    return t;
  }

  // Devuelve null si la petición puede pasar, o { codigo, error } si no.
  autorizar(req) {
    const ip = req.socket.remoteAddress ?? '?';
    const r = this.intentos.get(ip) ?? { n: 0, desde: Date.now(), bloqueadaHasta: 0 };
    if (r.bloqueadaHasta > Date.now()) return { codigo: 429, error: 'Demasiados intentos. Espere un minuto.' };
    const dada = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const h = (x) => createHash('sha256').update(x).digest();
    if (dada && timingSafeEqual(h(dada), h(this.token))) {
      this.intentos.delete(ip);
      return null;
    }
    if (Date.now() - r.desde > 60000) Object.assign(r, { n: 0, desde: Date.now() });
    r.n++;
    if (r.n >= 5) r.bloqueadaHasta = Date.now() + 60000;
    this.intentos.set(ip, r);
    return { codigo: 401, error: 'Clave incorrecta' };
  }

  auditar(req, accion, resultado) {
    const linea = { ts: new Date().toISOString(), ip: req.socket.remoteAddress, accion, ok: resultado.ok, mensaje: resultado.mensaje };
    try {
      appendFileSync(this.rutaAuditoria, `${JSON.stringify(linea)}\n`);
    } catch (e) {
      console.warn('No se pudo escribir la auditoría:', e.message);
    }
  }

  auditoria(n = 30) {
    if (!existsSync(this.rutaAuditoria)) return [];
    return readFileSync(this.rutaAuditoria, 'utf8').trim().split('\n').filter(Boolean).slice(-n).reverse().map((l) => JSON.parse(l));
  }

  todos() {
    const n = this.nodos;
    return [...n.inyectoras, n.mp, n.mez, ...n.sm1, ...n.pts, n.vis];
  }

  diagnostico() {
    const mem = process.memoryUsage();
    const mb = (b) => Math.round(b / 1048576);
    const tablas = this.mes.q(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
      .map(({ name }) => ({ tabla: name, filas: this.mes.q(`SELECT COUNT(*) n FROM "${name}"`).get().n }));
    const tam = (p) => (existsSync(p) ? statSync(p).size : 0);
    const ahora = this.reloj.ahora();
    const nodos = this.todos().map((x) => x.vista());
    const problemas = nodos
      .map((v) => ({ nombre: v.nombre, motivos: [v.sinSenal && 'sin señal LoRa', !v.conEnlace && 'sin enlace (reintentando)', v.bufer > 0 && `${v.bufer} eventos en búfer`, v.bloqueado && 'terminal bloqueada'].filter(Boolean) }))
      .filter((p) => p.motivos.length);
    const chequeos = [
      { nombre: 'Broker MQTT', ok: !this.broker.closed, detalle: `${Object.keys(this.broker.clients ?? {}).length} clientes conectados` },
      { nombre: 'MES conectado a MQTT', ok: !!this.mes.cliente?.connected, detalle: this.mes.cliente?.connected ? 'conectado' : 'desconectado' },
      { nombre: 'Puente LoRa → MQTT', ok: !!this.puente.cliente?.connected, detalle: `${this.puente.stats.publicadas ?? 0} publicadas · ${this.puente.stats.rechazadas ?? 0} rechazadas` },
      { nombre: 'Voceo', ok: !!this.voceo.cliente?.connected && this.ajustes.get().voceo.activo, detalle: `${this.ajustes.get().voceo.activo ? 'activo' : 'APAGADO'} · ${this.voceo.stats.voceados} voceados · ${this.voceo.avisos ? `${this.voceo.avisos.size} avisos en catálogo` : 'sin catálogo'}` },
      { nombre: 'Terminales', ok: !problemas.some((p) => p.motivos.includes('sin señal LoRa')), detalle: `${nodos.length} nodos · ${problemas.length} con algún problema` },
      { nombre: 'Memoria del proceso', ok: mem.rss < 220 * 1048576, detalle: `${mb(mem.rss)} MB (límite del contenedor 256 MB)` },
      { nombre: 'Errores recientes', ok: !ERRORES.some((e) => e.nivel === 'error'), detalle: `${ERRORES.filter((e) => e.nivel === 'error').length} errores · ${ERRORES.filter((e) => e.nivel === 'warn').length} avisos` },
    ];
    return {
      generado: new Date().toISOString(),
      relojSimulado: this.reloj.iso(ahora),
      version: this.version,
      chequeos,
      proceso: { node: process.version, pid: process.pid, activoMin: Math.round((Date.now() - this.inicio) / 60000), memoriaMB: { rss: mb(mem.rss), heap: mb(mem.heapUsed) } },
      equipo: { host: os.hostname(), sistema: `${os.type()} ${os.release()}`, cpus: os.cpus().length, carga: os.loadavg().map((x) => x.toFixed(2)), memoriaLibreMB: mb(os.freemem()), memoriaTotalMB: mb(os.totalmem()) },
      radio: { ...this.canal.stats, ocupacion: `${(this.canal.ocupacion() * 100).toFixed(1)} %`, perdidaBase: this.canal.perdidaBase },
      puente: this.puente.stats,
      mes: this.mes.stats,
      voceo: { ...this.voceo.stats, bloqueosAbiertos: [...this.voceo.abiertos.keys()] },
      base: { archivoMB: +(tam(this.rutaBD) / 1048576).toFixed(2), walMB: +(tam(`${this.rutaBD}-wal`) / 1048576).toFixed(2), tablas },
      terminalesConProblema: problemas,
      fallasProgramadas: this.sim.fallas,
      errores: ERRORES.slice(0, 20),
    };
  }

  acciones() {
    return Object.entries(ACCIONES).map(([id, a]) => ({ id, titulo: a.titulo, descripcion: a.descripcion, confirmar: !!a.confirmar }));
  }

  async ejecutar(id, req) {
    const a = ACCIONES[id];
    if (!a) return { ok: false, mensaje: 'Acción desconocida' };
    let r;
    try {
      r = await a.correr(this);
    } catch (e) {
      r = { ok: false, mensaje: e.message };
    }
    this.auditar(req, id, r);
    return r;
  }
}

// ───────────── Acciones de mantenimiento (lista fija) ─────────────
const ACCIONES = {
  bd_integridad: {
    titulo: 'Revisar integridad de la base',
    descripcion: 'Corre PRAGMA integrity_check en SQLite. Solo lee.',
    correr: (m) => {
      const r = m.mes.q('PRAGMA integrity_check').all().map((x) => Object.values(x)[0]);
      return { ok: r.length === 1 && r[0] === 'ok', mensaje: r.join('; ') };
    },
  },
  bd_respaldo: {
    titulo: 'Respaldar la base',
    descripcion: 'Copia la base a datos/respaldos/ sin detener el sistema.',
    correr: (m) => {
      const dir = join(m.dirDatos, 'respaldos');
      mkdirSync(dir, { recursive: true });
      const ruta = join(dir, `trazabilidad-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      m.mes.db.exec(`VACUUM INTO '${ruta.replaceAll("'", "''")}'`);
      return { ok: true, mensaje: `Respaldo en ${ruta} (${(statSync(ruta).size / 1048576).toFixed(2)} MB)` };
    },
  },
  bd_compactar: {
    titulo: 'Compactar el registro WAL',
    descripcion: 'Pasa el archivo -wal a la base principal (checkpoint). Útil si el -wal crece mucho.',
    correr: (m) => {
      const r = m.mes.q('PRAGMA wal_checkpoint(TRUNCATE)').get();
      return { ok: r.busy === 0, mensaje: `Páginas escritas: ${r.checkpointed} de ${r.log}${r.busy ? ' · la base estaba ocupada, intente de nuevo' : ''}` };
    },
  },
  terminales_desbloquear: {
    titulo: 'Desbloquear todas las terminales',
    descripcion: 'Manda DESBLOQUEAR por LoRa a cada inyectora bloqueada, como lo haría el supervisor.',
    confirmar: true,
    correr: (m) => {
      const bloqueadas = m.nodos.inyectoras.filter((n) => n.bloqueado).map((n) => n.nombre);
      for (const n of bloqueadas) m.mes.desbloquear(n).then(() => m.sim.log(`${n}: desbloqueada desde mantenimiento ASETI`));
      return { ok: true, mensaje: bloqueadas.length ? `Comando enviado a ${bloqueadas.join(', ')}` : 'No había terminales bloqueadas' };
    },
  },
  senal_restablecer: {
    titulo: 'Restablecer señal LoRa',
    descripcion: 'Quita los cortes de señal simulados en todas las terminales.',
    correr: (m) => {
      const n = m.canal.sinSenal.size;
      m.canal.sinSenal.clear();
      return { ok: true, mensaje: n ? `${n} terminales recuperan la señal` : 'Ninguna terminal estaba sin señal' };
    },
  },
  fallas_limpiar: {
    titulo: 'Quitar fallas programadas',
    descripcion: 'Borra las fallas que se programaron desde el panel y todavía no ocurren.',
    correr: (m) => {
      const n = m.sim.fallas.length;
      m.sim.fallas.length = 0;
      return { ok: true, mensaje: `${n} fallas quitadas` };
    },
  },
  voceo_prueba: {
    titulo: 'Prueba de voceo',
    descripcion: 'Publica el aviso «Prueba del sistema de voceo» para comprobar el conmutador.',
    correr: (m) => {
      if (!m.voceo.avisos?.has('general__prueba_sistema')) return { ok: false, mensaje: 'No está el catálogo de voceo' };
      m.voceo.vocear('general__prueba_sistema');
      return { ok: true, mensaje: 'Aviso publicado en el tópico voceo' };
    },
  },
  ajustes_restablecer: {
    titulo: 'Restablecer configuración',
    descripcion: 'Vuelve colores, nombres y reglas de voceo a los valores de fábrica.',
    confirmar: true,
    correr: (m) => {
      m.ajustes.restablecer();
      return { ok: true, mensaje: 'Configuración de fábrica aplicada' };
    },
  },
};
