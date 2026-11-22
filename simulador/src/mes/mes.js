// MES central: escucha MQTT, guarda la genealogía en SQL y aplica los gates que necesitan
// datos de varias estaciones (gates centrales). También envía comandos a los nodos.
import { EventEmitter } from 'node:events';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { dirname } from 'node:path';
import mqtt from 'mqtt';
import { idBolsa, pad } from '../ids.js';
import { FALLA_TEXTO } from '../protocolo/trama.js';

const NIVEL_AMBAR = new Set(['PESO_FUERA_TOLERANCIA', 'SECUENCIA_ROTA', 'CAJA_SIN_ENCINTAR', 'CAJA_INCOMPLETA', 'CAMARA_NO_CONFIRMA', 'DUPLICADO']);
const PLAZO_CONCILIACION_MS = 10 * 60 * 1000; // tiempo simulado para que lleguen eventos atrasados

export class MES extends EventEmitter {
  constructor({ reloj, mqttUrl, prefijo, rutaBD, rutaEsquema, porCharola }) {
    super();
    Object.assign(this, { reloj, mqttUrl, prefijo, porCharola });
    mkdirSync(dirname(rutaBD), { recursive: true });
    rmSync(rutaBD, { force: true });
    this.db = new DatabaseSync(rutaBD);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(readFileSync(rutaEsquema, 'utf8'));
    this.contadores = { ot: 0, caja: 0, tarima: 0, orden: 0, lote: 0 };
    this.esperasCmd = new Map();
    this.pendientes = []; // gates centrales que esperan eventos atrasados
    this.estadoNodos = new Map();
    this.stats = { eventos: 0, duplicados: 0, diferidos: 0, conciliados: 0, alertas: 0, despachos: 0 };
    this.q = (sql) => this.db.prepare(sql);
  }

  async iniciar() {
    this.cliente = mqtt.connect(this.mqttUrl, { clientId: 'mes-central', clean: true });
    await new Promise((ok, mal) => {
      this.cliente.once('connect', ok);
      this.cliente.once('error', mal);
    });
    await this.cliente.subscribeAsync([`${this.prefijo}/nodo/+/evento`, `${this.prefijo}/nodo/+/estado`, `${this.prefijo}/nodo/+/cmd_ack`], { qos: 1 });
    this.cliente.on('message', (topico, payload) => {
      let m;
      try {
        m = JSON.parse(payload.toString());
      } catch {
        return;
      }
      const tipo = topico.split('/').at(-1);
      if (tipo === 'evento') this.procesarEvento(m);
      else if (tipo === 'estado') this.estadoNodos.set(m.nodo, m);
      else if (tipo === 'cmd_ack') this.esperasCmd.get(m.id)?.(m);
    });
    this.timerPendientes = setInterval(() => this.revisarPendientes(), 1000);
  }

  ts() {
    return this.reloj.iso();
  }

  // ─────────────────────────── comandos a nodos ───────────────────────────
  comando(nodo, cmd, datos = {}) {
    const id = crypto.randomUUID();
    return new Promise((ok) => {
      const fin = (r) => {
        this.esperasCmd.delete(id);
        clearTimeout(t);
        ok(r);
      };
      const t = this.reloj.timeout(() => fin({ resultado: 'TIMEOUT' }), 120000);
      this.esperasCmd.set(id, fin);
      this.cliente.publish(`${this.prefijo}/nodo/${nodo}/cmd`, JSON.stringify({ id, cmd, datos }), { qos: 1 });
    });
  }

  async comandoConfirmado(nodo, cmd, datos) {
    for (;;) {
      const r = await this.comando(nodo, cmd, datos);
      if (r.resultado === 'PASS') return r;
      await this.reloj.esperar(15000); // sin respuesta: se reintenta (el nodo puede estar sin señal)
    }
  }

  // ─────────────────────────── acciones de oficina (no van por LoRa) ───────────────────────────
  registrarEventoMES(cp, resultado, codigo, { ot, ref, datos }) {
    this.q(`INSERT INTO eventos (nodo, seq, cp, resultado, codigo, ot, ref, datos, ts_nodo, ts_gateway, ts_mes) VALUES ('MES', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(cp, resultado, codigo, ot ?? null, ref ?? null, JSON.stringify(datos ?? {}), this.ts(), this.ts(), this.ts());
    const ev = { nodo: 'MES', cp, resultado, codigo, ts_mes: this.ts(), datos: { ot, ...datos } };
    this.cliente.publish(`${this.prefijo}/mes/evento`, JSON.stringify(ev));
    this.emit('evento', ev);
  }

  nuevoLote() {
    return `LMP-2611-${pad(++this.contadores.lote)}`;
  }
  nuevaCaja() {
    return `CJ-${pad(++this.contadores.caja, 6)}`;
  }
  nuevaTarima() {
    return `TR-${pad(++this.contadores.tarima, 4)}`;
  }
  nuevaOrdenEmbarque() {
    return `OE-2611-${pad(++this.contadores.orden)}`;
  }

  loteEnMezanina(sku) {
    return this.q(`SELECT id_lote FROM lotes_mp WHERE sku_resina = ? AND estado = 'APROBADO' AND ubicacion LIKE 'MEZ%' ORDER BY ts_traslado DESC LIMIT 1`).get(sku)?.id_lote;
  }

  // CP 03 · Planificación
  async crearOT({ maquina, producto, total, planificador = 'P01' }) {
    const ot = `OT-2611-${pad(++this.contadores.ot)}`;
    const lote = this.loteEnMezanina(producto.skuResina);
    const ok = !!lote;
    this.q(`INSERT INTO ordenes_trabajo (ot, id_maquina, id_molde, sku_producto, sku_resina, total_bolsas, peso_nominal_g, tolerancia_g, estado, id_planificador, ts_creacion) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      ot, maquina, producto.molde, producto.sku, producto.skuResina, total, producto.nominal, producto.tol, ok ? 'PROGRAMADA' : 'PENDIENTE_RESINA', planificador, this.ts(),
    );
    this.registrarEventoMES(3, ok ? 'PASS' : 'FAIL', ok ? 'PASS' : 'RESINA_NO_DISPONIBLE', { ot, datos: { maquina, molde: producto.molde, skuProducto: producto.sku, skuResina: producto.skuResina } });
    if (!ok) return { ok: false, ot };
    await this.comandoConfirmado('MEZ-01', 'CARGAR_FORMULA', { ot, skuResina: producto.skuResina });
    return { ok: true, ot };
  }

  // CP 05 · Liberación del sobre de OT (gate central: CP 04 en PASS)
  async liberarOT({ ot, operadores, supervisor = 'S01' }) {
    for (;;) {
      const carga = this.q(`SELECT 1 FROM cargas_resina WHERE ot = ? AND resultado = 'PASS'`).get(ot);
      if (carga) break;
      await this.reloj.esperar(5000); // el CP 04 puede venir atrasado en el búfer de la mezanina
    }
    const o = this.q(`SELECT * FROM ordenes_trabajo WHERE ot = ?`).get(ot);
    this.q(`UPDATE ordenes_trabajo SET estado = 'LIBERADA', id_supervisor = ?, ts_liberacion = ? WHERE ot = ?`).run(supervisor, this.ts(), ot);
    this.registrarEventoMES(5, 'PASS', 'PASS', { ot, datos: { total: o.total_bolsas, rango: `${idBolsa(ot, 1)} … ${idBolsa(ot, o.total_bolsas)}`, supervisor } });
    await this.comandoConfirmado(o.id_maquina, 'CARGAR_OT', {
      ot, skuProducto: o.sku_producto, total: o.total_bolsas, pesoNominal: o.peso_nominal_g, tolerancia: o.tolerancia_g, operadores,
    });
  }

  desbloquear(maquina) {
    return this.comandoConfirmado(maquina, 'DESBLOQUEAR', {});
  }

  async cerrarOT(ot) {
    const o = this.q(`SELECT id_maquina FROM ordenes_trabajo WHERE ot = ?`).get(ot);
    this.q(`UPDATE ordenes_trabajo SET estado = 'MOLDEO_TERMINADO' WHERE ot = ? AND estado = 'EN_PRODUCCION'`).run(ot);
    await this.comandoConfirmado(o.id_maquina, 'FIN_OT', { ot });
  }

  // ─────────────────────────── eventos de piso ───────────────────────────
  procesarEvento(ev) {
    const d = ev.datos || {};
    const ref = d.tarima ?? d.caja ?? (d.bolsa && d.ot ? idBolsa(d.ot, d.bolsa) : d.lote) ?? null;
    const r = this.q(`INSERT OR IGNORE INTO eventos (nodo, seq, cp, resultado, codigo, ot, ref, datos, ts_nodo, ts_gateway, ts_mes, diferido, rssi) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      ev.nodo, ev.seq, ev.cp, ev.resultado, ev.codigo, d.ot ?? null, ref, JSON.stringify(d), ev.ts_nodo, ev.ts_gateway, this.ts(), ev.diferido ? 1 : 0, ev.rssi ?? null,
    );
    if (r.changes === 0) {
      this.stats.duplicados++; // reintento de radio: ya lo teníamos
      this.emit('duplicado', ev);
      return;
    }
    this.stats.eventos++;
    if (ev.diferido) this.stats.diferidos++;

    if (ev.resultado === 'FAIL') {
      this.alerta({ nivel: NIVEL_AMBAR.has(ev.codigo) ? 'ambar' : 'rojo', origen: 'nodo', cp: ev.cp, nodo: ev.nodo, ot: d.ot, codigo: ev.codigo, mensaje: `${FALLA_TEXTO[ev.codigo] ?? ev.codigo}${ref ? ` · ${ref}` : ''}` });
    } else {
      const h = this[`cp${ev.cp}`];
      if (h) h.call(this, d, ev);
    }
    this.emit('evento', ev);
    this.revisarPendientes();
  }

  // CP 01
  cp1(d, ev) {
    this.q(`INSERT OR REPLACE INTO lotes_mp (id_lote, sku_resina, proveedor, cantidad_kg, estado, ubicacion, id_almacenista, ts_recepcion) VALUES (?,?,?,?, 'APROBADO', 'ALMACEN_MP', ?, ?)`).run(d.lote, d.skuResina, d.proveedor, d.cantidad, d.operador, ev.ts_nodo);
  }
  // CP 02
  cp2(d, ev) {
    this.q(`UPDATE lotes_mp SET ubicacion = ?, ts_traslado = ? WHERE id_lote = ?`).run(d.ubicacion, ev.ts_nodo, d.lote);
  }
  // CP 04
  cp4(d, ev) {
    this.q(`INSERT INTO cargas_resina (ot, id_lote, sku_resina, id_embudo, id_operador, resultado, ts) VALUES (?,?,?,?,?, 'PASS', ?)`).run(d.ot, d.lote, d.skuResina, d.embudo, d.operador, ev.ts_nodo);
  }
  // CP 06
  cp6(d, ev) {
    this.q(`UPDATE ordenes_trabajo SET estado = 'EN_PRODUCCION', id_operador = ?, ts_arranque = ? WHERE ot = ?`).run(d.operador, ev.ts_nodo, d.ot);
  }
  // CP 07
  cp7(d, ev) {
    this.q(`INSERT OR IGNORE INTO bolsas (id_bolsa, ot, correlativo, peso_g, charola, id_operador, estado, ts_moldeo) VALUES (?,?,?,?,?,?, 'MOLDEADA', ?)`).run(
      idBolsa(d.ot, d.bolsa), d.ot, d.bolsa, d.peso, Math.ceil(d.bolsa / this.porCharola), d.operador, ev.ts_nodo,
    );
  }
  // CP 08
  cp8(d, ev) {
    this.q(`INSERT INTO inspecciones_tep (ot, charola, id_bolsa, resultado, id_inspector, ts) VALUES (?,?,?, 'PASS', ?, ?)`).run(d.ot, d.charola, idBolsa(d.ot, d.bolsa), d.operador, ev.ts_nodo);
    this.q(`UPDATE bolsas SET estado = 'INSPECCIONADA' WHERE ot = ? AND charola = ? AND estado IN ('MOLDEADA', 'CUARENTENA_TEP')`).run(d.ot, d.charola);
  }
  // CP 09
  cp9(d) {
    this.q(`UPDATE bolsas SET estado = 'LIBERADA' WHERE ot = ? AND charola = ? AND estado = 'INSPECCIONADA'`).run(d.ot, d.charola);
  }
  // CP 10
  cp10(d) {
    this.q(`UPDATE bolsas SET estado = 'EN_TRASLADO' WHERE ot = ? AND charola = ? AND estado = 'LIBERADA'`).run(d.ot, d.charola);
  }
  // CP 11 · gate central: la bolsa debe venir de CP 10 y no estar en otra caja
  cp11(d, ev) {
    const bolsa = idBolsa(d.ot, d.bolsa);
    this.q(`INSERT OR IGNORE INTO cajas (id_caja, ot, capacidad, estado, id_charolero) VALUES (?,?,?, 'EN_EMPAQUE', ?)`).run(d.caja, d.ot, d.total, d.operador);
    const otraCaja = this.q(`SELECT id_caja FROM caja_bolsas WHERE id_bolsa = ? AND id_caja <> ?`).get(bolsa, d.caja);
    if (otraCaja) {
      return this.alerta({ nivel: 'rojo', origen: 'mes', cp: 11, nodo: ev.nodo, ot: d.ot, codigo: 'DUPLICADO', mensaje: `${bolsa} ya está en ${otraCaja.id_caja}; escaneada otra vez en ${d.caja}` });
    }
    this.q(`INSERT OR IGNORE INTO caja_bolsas (id_caja, id_bolsa, posicion, ts) VALUES (?,?,?,?)`).run(d.caja, bolsa, d.posicion, ev.ts_nodo);
    this.q(`UPDATE cajas SET total_bolsas = (SELECT COUNT(*) FROM caja_bolsas WHERE id_caja = ?) WHERE id_caja = ?`).run(d.caja, d.caja);
    this.exigir({
      cp: 11, nodo: ev.nodo, ot: d.ot, ref: bolsa,
      descripcion: `${bolsa} empacada en ${d.caja} sin CP 10 (retiro por charolero) registrado`,
      cumple: () => {
        const b = this.q(`SELECT estado FROM bolsas WHERE id_bolsa = ?`).get(bolsa);
        if (!b || !['EN_TRASLADO', 'EN_CAJA'].includes(b.estado)) return false;
        this.q(`UPDATE bolsas SET estado = 'EN_CAJA' WHERE id_bolsa = ?`).run(bolsa);
        return true;
      },
    });
  }
  // CP 12
  cp12(d, ev) {
    this.q(`UPDATE cajas SET estado = 'CERRADA', id_inspector_2 = ?, ts_cierre = ? WHERE id_caja = ?`).run(d.operador, ev.ts_nodo, d.caja);
  }
  // CP 13 · gate central: la caja debe estar cerrada (CP 12, otro nodo)
  cp13(d, ev) {
    this.exigir({
      cp: 13, nodo: ev.nodo, ot: d.ot, ref: d.caja,
      descripcion: `${d.caja} ingresó a pre-envío sin cierre de CP 12`,
      cumple: () => {
        const c = this.q(`SELECT estado FROM cajas WHERE id_caja = ?`).get(d.caja);
        if (['EN_PT', 'EN_TARIMA', 'DESPACHADA'].includes(c?.estado)) return true;
        if (c?.estado !== 'CERRADA') return false;
        this.q(`UPDATE cajas SET estado = 'EN_PT', ubicacion = ?, ts_ingreso_pt = ? WHERE id_caja = ?`).run(d.ubicacion, ev.ts_nodo, d.caja);
        return true;
      },
    });
  }
  // CP 14
  cp14(d, ev) {
    this.q(`INSERT OR IGNORE INTO tarimas (id_tarima, orden_embarque, numero_parte, estado) VALUES (?,?,?, 'ARMANDO')`).run(d.tarima, d.orden, d.numeroParte);
    if (d.cierre) {
      this.q(`UPDATE tarimas SET estado = 'ARMADA', cajas_esperadas = ? WHERE id_tarima = ?`).run(d.total, d.tarima);
      return;
    }
    this.exigir({
      cp: 14, nodo: ev.nodo, ref: d.caja,
      descripcion: `${d.caja} paletizada en ${d.tarima} sin ingreso a PT (CP 13)`,
      cumple: () => {
        const c = this.q(`SELECT estado FROM cajas WHERE id_caja = ?`).get(d.caja);
        if (!c || !['EN_PT', 'EN_TARIMA'].includes(c.estado)) return false;
        this.q(`UPDATE cajas SET estado = 'EN_TARIMA', id_tarima = ? WHERE id_caja = ?`).run(d.tarima, d.caja);
        return true;
      },
    });
  }
  // CP 15 · gate central: la tarima debe estar armada (CP 14, otro nodo)
  cp15(d, ev) {
    this.exigir({
      cp: 15, nodo: ev.nodo, ref: d.tarima,
      descripcion: `${d.tarima} verificada en cámara sin cierre de CP 14`,
      cumple: () => {
        const t = this.q(`SELECT estado FROM tarimas WHERE id_tarima = ?`).get(d.tarima);
        if (!t || !['ARMADA', 'VERIFICADA'].includes(t.estado)) return false;
        this.q(`UPDATE tarimas SET caras_ok = MAX(caras_ok, ?), estado = CASE WHEN ? >= 4 THEN 'VERIFICADA' ELSE estado END WHERE id_tarima = ?`).run(d.cantidad, d.cantidad, d.tarima);
        return true;
      },
    });
  }
  // CP 16 · cierre de trazabilidad y aviso al ERP
  cp16(d, ev) {
    this.exigir({
      cp: 16, nodo: ev.nodo, ref: d.tarima,
      descripcion: `${d.tarima} despachada sin verificación 4/4`,
      cumple: () => {
        const t = this.q(`SELECT * FROM tarimas WHERE id_tarima = ?`).get(d.tarima);
        if (t?.estado !== 'VERIFICADA') return false;
        this.q(`UPDATE tarimas SET estado = 'DESPACHADA', puerta = ?, ts_despacho = ? WHERE id_tarima = ?`).run(d.puerta, ev.ts_nodo, d.tarima);
        this.q(`UPDATE cajas SET estado = 'DESPACHADA' WHERE id_tarima = ?`).run(d.tarima);
        const cajas = this.q(`SELECT id_caja, ot FROM cajas WHERE id_tarima = ?`).all(d.tarima);
        const ots = [...new Set(cajas.map((c) => c.ot))];
        for (const ot of ots) {
          const faltan = this.q(`SELECT COUNT(*) n FROM bolsas b LEFT JOIN caja_bolsas cb ON cb.id_bolsa = b.id_bolsa LEFT JOIN cajas c ON c.id_caja = cb.id_caja WHERE b.ot = ? AND (c.estado IS NULL OR c.estado <> 'DESPACHADA')`).get(ot).n;
          if (faltan === 0) this.q(`UPDATE ordenes_trabajo SET estado = 'COMPLETO', ts_cierre = ? WHERE ot = ?`).run(ev.ts_nodo, ot);
        }
        this.stats.despachos++;
        this.cliente.publish(`${this.prefijo}/erp/despacho`, JSON.stringify({ tarima: d.tarima, orden_embarque: t.orden_embarque, numero_parte: t.numero_parte, puerta: d.puerta, cajas: cajas.map((c) => c.id_caja), ots, estatus_trazabilidad: 'COMPLETO', ts_salida: ev.ts_nodo }), { qos: 1 });
        return true;
      },
    });
  }

  // ─────────────────────────── gates centrales con conciliación ───────────────────────────
  exigir(p) {
    if (p.cumple()) return;
    this.pendientes.push({ ...p, vence: this.reloj.ahora() + PLAZO_CONCILIACION_MS });
  }

  revisarPendientes() {
    const ahora = this.reloj.ahora();
    this.pendientes = this.pendientes.filter((p) => {
      if (p.cumple()) {
        this.stats.conciliados++;
        return false;
      }
      if (ahora > p.vence) {
        this.alerta({ nivel: 'rojo', origen: 'mes', cp: p.cp, nodo: p.nodo, ot: p.ot, codigo: 'GATE_PREVIO_NO_PASS', mensaje: p.descripcion });
        return false;
      }
      return true;
    });
  }

  alerta(a) {
    const ts = this.ts();
    this.q(`INSERT INTO alertas (ts, nivel, origen, cp, nodo, ot, codigo, mensaje) VALUES (?,?,?,?,?,?,?,?)`).run(ts, a.nivel, a.origen, a.cp, a.nodo ?? null, a.ot ?? null, a.codigo, a.mensaje);
    this.stats.alertas++;
    const full = { ts, ...a };
    this.cliente.publish(`${this.prefijo}/alerta`, JSON.stringify(full));
    this.emit('alerta', full);
  }

  // ─────────────────────────── consultas para el panel ───────────────────────────
  resumen() {
    const porCP = this.q(`SELECT cp, SUM(resultado = 'PASS') pass, SUM(resultado = 'FAIL') fail FROM eventos GROUP BY cp`).all();
    const ots = this.q(`SELECT estado, COUNT(*) n FROM ordenes_trabajo GROUP BY estado`).all();
    const cuenta = (t, w = '') => this.q(`SELECT COUNT(*) n FROM ${t} ${w}`).get().n;
    return {
      stats: { ...this.stats, pendientes: this.pendientes.length },
      porCP: Object.fromEntries(porCP.map((r) => [r.cp, { pass: r.pass, fail: r.fail }])),
      ots: Object.fromEntries(ots.map((r) => [r.estado, r.n])),
      bolsas: cuenta('bolsas'),
      cajas: cuenta('cajas', `WHERE estado <> 'EN_EMPAQUE'`),
      tarimasDespachadas: cuenta('tarimas', `WHERE estado = 'DESPACHADA'`),
      alertas: this.q(`SELECT * FROM alertas ORDER BY id DESC LIMIT 40`).all(),
      pendientes: this.pendientes.map((p) => ({ cp: p.cp, ref: p.ref, descripcion: p.descripcion, venceEnS: Math.round((p.vence - this.reloj.ahora()) / 1000) })),
      otsRecientes: this.q(`SELECT o.ot, o.id_maquina, o.sku_producto, o.estado, o.total_bolsas,
          (SELECT COUNT(*) FROM bolsas b WHERE b.ot = o.ot) bolsas,
          (SELECT COUNT(*) FROM cajas c WHERE c.ot = o.ot AND c.estado <> 'EN_EMPAQUE') cajas,
          (SELECT COUNT(*) FROM cajas c WHERE c.ot = o.ot AND c.estado = 'DESPACHADA') despachadas
        FROM ordenes_trabajo o ORDER BY o.estado = 'COMPLETO', o.ts_creacion DESC LIMIT 80`).all(),
    };
  }

  // Genealogía hacia atrás y hacia adelante a partir de cualquier código
  genealogia(codigo) {
    const id = String(codigo || '').trim().toUpperCase();
    let ot = null;
    let foco = null;
    if (/^OT-\d+-\d+-B\d+$/.test(id)) {
      const b = this.q(`SELECT * FROM bolsas WHERE id_bolsa = ?`).get(id);
      if (!b) return null;
      ot = b.ot;
      foco = { tipo: 'bolsa', id };
    } else if (id.startsWith('OT-')) {
      ot = id;
      foco = { tipo: 'ot', id };
    } else if (id.startsWith('CJ-')) {
      const c = this.q(`SELECT * FROM cajas WHERE id_caja = ?`).get(id);
      if (!c) return null;
      ot = c.ot;
      foco = { tipo: 'caja', id };
    } else if (id.startsWith('TR-')) {
      const t = this.q(`SELECT * FROM tarimas WHERE id_tarima = ?`).get(id);
      if (!t) return null;
      const ots = this.q(`SELECT DISTINCT ot FROM cajas WHERE id_tarima = ?`).all(id).map((r) => r.ot);
      ot = ots[0];
      foco = { tipo: 'tarima', id };
    } else if (id.startsWith('LMP-')) {
      const l = this.q(`SELECT * FROM lotes_mp WHERE id_lote = ?`).get(id);
      if (!l) return null;
      const ots = this.q(`SELECT DISTINCT ot FROM cargas_resina WHERE id_lote = ?`).all(id).map((r) => r.ot);
      return { foco: { tipo: 'lote', id }, lote: l, ots: ots.map((o) => this.q(`SELECT ot, id_maquina, sku_producto, estado FROM ordenes_trabajo WHERE ot = ?`).get(o)), eventos: this.q(`SELECT * FROM eventos WHERE ref = ? ORDER BY ts_nodo`).all(id) };
    }
    const orden = this.q(`SELECT * FROM ordenes_trabajo WHERE ot = ?`).get(ot);
    if (!orden) return null;
    const lotes = this.q(`SELECT l.* , cr.id_embudo, cr.ts ts_carga FROM cargas_resina cr JOIN lotes_mp l ON l.id_lote = cr.id_lote WHERE cr.ot = ?`).all(ot);
    const cajas = this.q(`SELECT * FROM cajas WHERE ot = ? ORDER BY id_caja`).all(ot).map((c) => ({
      ...c,
      bolsas: this.q(`SELECT cb.posicion, b.* FROM caja_bolsas cb LEFT JOIN bolsas b ON b.id_bolsa = cb.id_bolsa WHERE cb.id_caja = ? ORDER BY cb.posicion`).all(c.id_caja),
      tarima: c.id_tarima ? this.q(`SELECT * FROM tarimas WHERE id_tarima = ?`).get(c.id_tarima) : null,
    }));
    const sinCaja = this.q(`SELECT b.* FROM bolsas b LEFT JOIN caja_bolsas cb ON cb.id_bolsa = b.id_bolsa WHERE b.ot = ? AND cb.id_bolsa IS NULL ORDER BY b.correlativo`).all(ot);
    let eventos;
    if (foco.tipo === 'bolsa') {
      const b = this.q(`SELECT * FROM bolsas WHERE id_bolsa = ?`).get(id);
      const caja = this.q(`SELECT id_caja FROM caja_bolsas WHERE id_bolsa = ?`).get(id)?.id_caja;
      const tarima = caja && this.q(`SELECT id_tarima FROM cajas WHERE id_caja = ?`).get(caja)?.id_tarima;
      eventos = this.q(`SELECT * FROM eventos WHERE (ot = ? AND (ref = ? OR cp IN (3,4,5,6) OR (cp IN (8,9,10) AND json_extract(datos,'$.charola') = ?))) OR (ref = ? AND ref IS NOT NULL) OR (ref = ? AND ref IS NOT NULL) ORDER BY ts_nodo, id`).all(ot, id, b.charola, caja ?? '-', tarima ?? '-');
    } else if (foco.tipo === 'caja') {
      const tarima = this.q(`SELECT id_tarima FROM cajas WHERE id_caja = ?`).get(id)?.id_tarima;
      eventos = this.q(`SELECT * FROM eventos WHERE ref = ? OR (ref = ? AND ref IS NOT NULL) OR (ot = ? AND cp IN (3,4,5,6)) ORDER BY ts_nodo, id`).all(id, tarima ?? '-', ot);
    } else if (foco.tipo === 'tarima') {
      eventos = this.q(`SELECT * FROM eventos WHERE ref = ? OR ref IN (SELECT id_caja FROM cajas WHERE id_tarima = ?) ORDER BY ts_nodo, id`).all(id, id);
    } else {
      eventos = this.q(`SELECT * FROM eventos WHERE ot = ? OR ref IN (SELECT id_caja FROM cajas WHERE ot = ?) OR ref IN (SELECT id_tarima FROM cajas WHERE ot = ? AND id_tarima IS NOT NULL) ORDER BY ts_nodo, id`).all(ot, ot, ot);
    }
    return { foco, orden, lotes, cajas, sinCaja, eventos: eventos.slice(-400) };
  }

  cerrar() {
    clearInterval(this.timerPendientes);
    this.cliente?.end(true);
    this.db.close();
  }
}
