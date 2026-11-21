// Lógica de gate local por tipo de estación (lo que correría en cada terminal).
// Cada método recibe lo que se escaneó, valida con lo que el nodo tiene en memoria,
// actualiza su pantalla/Andon y emite el evento hacia el gateway.
import { Nodo } from './nodo.js';
import { FALLA, FALLA_NOMBRE, FALLA_TEXTO, CMD } from '../protocolo/trama.js';
import { idBolsa, charolaDe } from '../ids.js';

const texto = (c) => FALLA_TEXTO[FALLA_NOMBRE[c]];

// ───────────────────────── CP 01–02 · Almacén MP ─────────────────────────
export class NodoAlmacenMP extends Nodo {
  constructor(o) {
    super({ ...o, tipo: 'almacen_mp' });
    this.lotes = new Map();
    this.mostrar(this.nombre, 'Listo', 'gris');
  }

  recibirLote({ lote, sku, proveedor, kg, certificado, almacenista }) {
    const c = certificado ? FALLA.PASS : FALLA.CERTIFICADO_INVALIDO;
    this.lotes.set(lote, { ok: c === FALLA.PASS, sku });
    this.mostrar(`CP01 ${lote}`, c ? texto(c) : `${sku} · ${kg} kg aprobado`, c ? 'rojo' : 'verde');
    return this.emitir(1, c, { lote, skuResina: sku, proveedor, cantidad: kg, operador: almacenista });
  }

  trasladar({ lote, ubicacion, almacenista }) {
    const c = this.lotes.get(lote)?.ok ? FALLA.PASS : FALLA.GATE_PREVIO_NO_PASS;
    this.mostrar(`CP02 ${lote}`, c ? texto(c) : `Subido a ${ubicacion}`, c ? 'rojo' : 'verde');
    return this.emitir(2, c, { lote, ubicacion, operador: almacenista });
  }
}

// ───────────────────────── CP 04 · Mezanina (embudos) ─────────────────────────
export class NodoMezanina extends Nodo {
  constructor(o) {
    super({ ...o, tipo: 'mezanina' });
    this.formulas = new Map(); // OT → SKU de resina (llega por comando desde el MES)
    this.mostrar(this.nombre, 'Sin OT', 'gris');
  }

  manejarComando(codigo, d) {
    if (codigo === CMD.CARGAR_FORMULA) {
      this.formulas.set(d.ot, d.skuResina);
      if (this.formulas.size > 60) this.formulas.delete(this.formulas.keys().next().value);
    }
    return FALLA.PASS;
  }

  cargarResina({ ot, lote, skuResina, embudo, operador }) {
    let c = FALLA.PASS;
    if (!this.formulas.has(ot)) c = FALLA.OT_NO_ASIGNADA;
    else if (this.formulas.get(ot) !== skuResina) c = FALLA.RESINA_INCORRECTA;
    this.mostrar(`CP04 ${embudo}`, c ? `${texto(c)} (${skuResina})` : `${ot} · ${skuResina} OK, vaciar`, c ? 'rojo' : 'verde');
    return this.emitir(4, c, { ot, lote, skuResina, embudo, operador });
  }

  datosEstado() {
    return { cantidad: this.formulas.size };
  }
}

// ───────────────────────── CP 06–10 · Terminal de inyectora ─────────────────────────
export class NodoInyectora extends Nodo {
  constructor(o) {
    super({ ...o, tipo: 'inyectora' });
    this.qr = `QR-${this.nombre}`;
    this.porCharola = o.porCharola;
    this.limpiarOT();
    this.mostrar(this.nombre, 'Sin OT', 'gris');
  }

  limpiarOT() {
    this.ot = null;
    this.cfgOT = null;
    this.arrancada = false;
    this.bloqueado = false;
    this.siguiente = 1;
    this.bolsas = new Map();
    this.charolas = new Map();
    this.operador = null;
    this.lecturas = {}; // arranque en curso: gafete → OT → QR
    this.peso = null; // lo que marca la báscula
  }

  // Báscula conectada por RS-232: el nodo solo guarda la última lectura estable
  pesar(gramos) {
    this.peso = Math.round(gramos);
    if (this.arrancada && !this.bloqueado) this.mostrar(`OT ${this.ot}`, `Báscula ${this.peso} g · escanee etiqueta`, 'ambar');
  }

  // Lector de códigos: el firmware decide qué es cada código por su formato
  escanear(codigo) {
    const c = String(codigo).trim().toUpperCase();
    const aviso = (l2, color = 'ambar') => {
      this.mostrar(this.ot ? `OT ${this.ot}` : this.nombre, l2, color);
      return { evento: null, mensaje: l2 };
    };
    if (!this.ot) return aviso('Sin OT cargada: espere la liberación del sobre (CP 05)', 'gris');

    const bolsa = /^(OT-\d+-\d+)-B(\d+)$/.exec(c);
    if (bolsa) {
      if (!this.arrancada) return aviso('Primero el arranque: gafete, OT y QR');
      if (bolsa[1] !== this.ot) {
        const r = this.emitir(7, FALLA.OT_NO_ASIGNADA, { ot: bolsa[1], bolsa: Number(bolsa[2]), operador: this.operador });
        this.mostrar(`Etiqueta ${c}`, 'La etiqueta es de otra OT', 'rojo');
        return { evento: r, mensaje: 'La etiqueta es de otra OT' };
      }
      if (this.peso == null) return aviso('Coloque la bolsa en la báscula');
      const r = this.registrarBolsa({ k: Number(bolsa[2]), peso: this.peso });
      if (r.ok) this.peso = null; // la bolsa se retira de la báscula
      return { evento: r, mensaje: r.texto };
    }

    if (this.arrancada) return aviso('Máquina en producción: escanee etiquetas de bolsa');
    if (this.bloqueado) return aviso('Terminal bloqueada: requiere supervisor', 'rojo');

    if (/^E\d+$/.test(c)) {
      this.lecturas = { gafete: c };
      return aviso(`Gafete ${c} ✓ · escanee la OT`);
    }
    if (/^OT-\d+-\d+$/.test(c)) {
      if (!this.lecturas.gafete) return aviso('Primero escanee su gafete');
      this.lecturas.ot = c;
      return aviso(`OT ${c} ✓ · escanee el QR de la máquina`);
    }
    if (/^QR-/.test(c)) {
      if (!this.lecturas.gafete || !this.lecturas.ot) return aviso('Orden: gafete, OT y después QR');
      const { gafete, ot } = this.lecturas;
      this.lecturas = {};
      const r = this.arrancar({ gafete, ot, qr: c });
      return { evento: r, mensaje: r.texto };
    }
    return aviso(`Código no reconocido: ${c}`, 'rojo');
  }

  manejarComando(codigo, d) {
    if (codigo === CMD.CARGAR_OT) {
      this.limpiarOT();
      this.ot = d.ot;
      this.cfgOT = { total: d.total, nominal: d.pesoNominal, tol: d.tolerancia, operadores: d.operadores, sku: d.skuProducto };
      this.mostrar(`OT ${d.ot}`, 'Escanee gafete, OT y QR', 'ambar');
    } else if (codigo === CMD.DESBLOQUEAR) {
      this.bloqueado = false;
      this.lecturas = {};
      this.mostrar(`OT ${this.ot ?? '—'}`, 'Desbloqueada por supervisor', 'ambar');
    } else if (codigo === CMD.FIN_OT) {
      this.limpiarOT();
      this.mostrar(this.nombre, 'OT cerrada · sin OT', 'gris');
    }
    return FALLA.PASS;
  }

  // CP 06: gafete + OT + QR de máquina
  arrancar({ gafete, ot, qr }) {
    let c = FALLA.PASS;
    if (!this.ot) c = FALLA.OT_NO_ASIGNADA;
    else if (this.bloqueado) c = FALLA.NODO_BLOQUEADO;
    else if (!this.cfgOT.operadores.includes(gafete)) c = FALLA.OPERADOR_NO_HABILITADO;
    else if (ot !== this.ot) c = FALLA.OT_NO_ASIGNADA;
    else if (qr !== this.qr) c = FALLA.QR_MAQUINA_INCORRECTO;

    if (c === FALLA.PASS) {
      this.arrancada = true;
      this.operador = gafete;
      this.mostrar(`OT ${ot}`, `Arranque OK · ${gafete}`, 'verde');
    } else {
      this.bloqueado = true;
      this.mostrar('BLOQUEADA', texto(c), 'rojo');
    }
    return this.emitir(6, c, { ot, operador: gafete, maquina: qr });
  }

  // CP 07: bolsa k/n con peso
  registrarBolsa({ k, peso }) {
    let c = FALLA.PASS;
    if (!this.arrancada || this.bloqueado) c = FALLA.GATE_PREVIO_NO_PASS;
    else if (k !== this.siguiente) c = FALLA.SECUENCIA_ROTA;
    else if (Math.abs(peso - this.cfgOT.nominal) > this.cfgOT.tol) c = FALLA.PESO_FUERA_TOLERANCIA;

    const n = this.cfgOT?.total ?? 0;
    if (c === FALLA.PASS) {
      const ch = charolaDe(k, this.porCharola);
      this.bolsas.set(k, { peso });
      if (!this.charolas.has(ch)) this.charolas.set(ch, { estado: 'LLENANDO' });
      this.siguiente++;
      this.mostrar(`OT ${this.ot}`, `Bolsa ${k}/${n} · ${peso} g`, 'verde');
    } else {
      this.mostrar(`Bolsa ${k}/${n}`, `${texto(c)}${c === FALLA.PESO_FUERA_TOLERANCIA ? ` (${peso} g)` : ''}`, 'rojo');
    }
    return this.emitir(7, c, { ot: this.ot, bolsa: k, total: n, peso, operador: this.operador });
  }

  // CP 08: inspección visual TEP 1 (muestra de una bolsa de la charola)
  inspeccionar({ k, inspector, defecto }) {
    const ch = charolaDe(k, this.porCharola);
    let c = FALLA.PASS;
    if (!this.bolsas.has(k)) c = FALLA.GATE_PREVIO_NO_PASS;
    else if (defecto) c = FALLA.DEFECTO_CRITICO;
    const charola = this.charolas.get(ch);
    if (charola) charola.estado = c ? 'CUARENTENA' : 'INSPECCIONADA';
    this.mostrar(`CP08 charola ${ch}`, c ? texto(c) : `Muestra bolsa ${k} OK · sellada`, c ? 'rojo' : 'verde');
    return this.emitir(8, c, { ot: this.ot, bolsa: k, charola: ch, operador: inspector, defecto: defecto ? 1 : 0 });
  }

  // CP 09: liberación de charola por supervisor
  liberarCharola({ charola, supervisor }) {
    const ch = this.charolas.get(charola);
    const c = ch?.estado === 'INSPECCIONADA' ? FALLA.PASS : FALLA.GATE_PREVIO_NO_PASS;
    if (!c) ch.estado = 'LIBERADA';
    this.mostrar(`CP09 charola ${charola}`, c ? texto(c) : 'Liberada por supervisor', c ? 'rojo' : 'verde');
    return this.emitir(9, c, { ot: this.ot, charola, cantidad: this.porCharola, operador: supervisor });
  }

  // CP 10: retiro por charolero
  retirarCharola({ charola, charolero }) {
    const ch = this.charolas.get(charola);
    const c = ch?.estado === 'LIBERADA' ? FALLA.PASS : FALLA.GATE_PREVIO_NO_PASS;
    if (!c) ch.estado = 'RETIRADA';
    this.mostrar(`CP10 charola ${charola}`, c ? texto(c) : `Retirada hacia SM1 · ${charolero}`, c ? 'rojo' : 'verde');
    return this.emitir(10, c, { ot: this.ot, charola, operador: charolero });
  }

  datosEstado() {
    return this.ot ? { ot: this.ot, bolsa: this.siguiente - 1, total: this.cfgOT.total } : {};
  }

  vista() {
    return { ...super.vista(), ot: this.ot, bolsa: this.siguiente - 1, total: this.cfgOT?.total ?? 0, arrancada: this.arrancada, peso: this.peso, lecturas: this.lecturas };
  }
}

// ───────────────────────── CP 11–12 · SM1 con pantalla AV ─────────────────────────
export class NodoSM1 extends Nodo {
  constructor(o) {
    super({ ...o, tipo: 'sm1' });
    this.caja = null;
    this.historial = new Set(); // bolsas ya empacadas en cajas cerradas
    this.av = { caja: null, ot: null, divisiones: [], alerta: null };
    this.mostrar(this.nombre, 'Escanee gafete y caja', 'gris');
  }

  // El charolero escanea su gafete, la caja y la carpeta de la OT: la caja queda ligada a esa OT
  abrirCaja({ caja, ot, charolero, capacidad }) {
    this.caja = { id: caja, ot, cap: capacidad, bolsas: [], charolero };
    this.av = { caja, ot, divisiones: Array(capacidad).fill(null), alerta: null };
    this.mostrar(`Caja ${caja}`, `0/${capacidad} · escanee bolsas`, 'ambar');
  }

  // CP 11: cada bolsa que entra a la caja
  escanearBolsa({ ot, k }) {
    const id = idBolsa(ot, k);
    let c = FALLA.PASS;
    if (!this.caja) c = FALLA.GATE_PREVIO_NO_PASS;
    else if (this.historial.has(id) || this.caja.bolsas.includes(id)) c = FALLA.DUPLICADO;
    else if (this.caja.ot !== ot) c = FALLA.BOLSA_OTRA_OT;
    else if (this.caja.bolsas.length >= this.caja.cap) c = FALLA.CAJA_LLENA;

    let posicion = 0;
    if (c === FALLA.PASS) {
      this.caja.bolsas.push(id);
      posicion = this.caja.bolsas.length;
      this.av.ot = this.caja.ot;
      this.av.divisiones[posicion - 1] = id;
      this.av.alerta = null;
      this.mostrar(`Caja ${this.caja.id}`, `${posicion}/${this.caja.cap} · ${id}`, posicion === this.caja.cap ? 'verde' : 'ambar');
    } else {
      this.av.alerta = `${texto(c)}: ${id}`;
      this.mostrar(`Caja ${this.caja?.id ?? '—'}`, texto(c), 'rojo');
    }
    return this.emitir(11, c, { ot, bolsa: k, caja: this.caja?.id, posicion, total: this.caja?.cap, operador: this.caja?.charolero });
  }

  // CP 12: inspector 2 cierra la caja
  cerrarCaja({ inspector, encintada }) {
    const caja = this.caja;
    let c = FALLA.PASS;
    if (!caja) c = FALLA.GATE_PREVIO_NO_PASS;
    else if (caja.bolsas.length < caja.cap) c = FALLA.CAJA_INCOMPLETA;
    else if (!encintada) c = FALLA.CAJA_SIN_ENCINTAR;

    const r = this.emitir(12, c, { ot: caja?.ot, caja: caja?.id, cantidad: caja?.bolsas.length ?? 0, operador: inspector });
    if (c === FALLA.PASS) {
      caja.bolsas.forEach((b) => this.historial.add(b));
      this.mostrar(`Caja ${caja.id}`, 'Cerrada y sellada', 'verde');
      this.caja = null;
      this.av.alerta = null;
      this.av.cerrada = true;
    } else {
      this.av.alerta = texto(c);
      this.mostrar(`Caja ${caja?.id ?? '—'}`, texto(c), 'rojo');
    }
    return r;
  }

  vista() {
    return { ...super.vista(), av: this.av };
  }
}

// ───────────────────────── CP 13–14 · Almacén PT ─────────────────────────
export class NodoAlmacenPT extends Nodo {
  constructor(o) {
    super({ ...o, tipo: 'almacen_pt' });
    this.ingresadas = new Set();
    this.tarima = null;
    this.mostrar(this.nombre, 'Listo', 'gris');
  }

  // CP 13
  ingresarCaja({ caja, ot, ubicacion, almacenista }) {
    const c = this.ingresadas.has(caja) ? FALLA.DUPLICADO : FALLA.PASS;
    if (!c) this.ingresadas.add(caja);
    this.mostrar(`CP13 ${caja}`, c ? texto(c) : `Ingreso a ${ubicacion}`, c ? 'rojo' : 'verde');
    return this.emitir(13, c, { caja, ot, ubicacion, operador: almacenista });
  }

  // CP 14 (inicio, local)
  iniciarTarima({ tarima, orden, numeroParte, esperadas, almacenista }) {
    this.tarima = { id: tarima, orden, numeroParte, esperadas, cajas: [], almacenista };
    this.mostrar(`Tarima ${tarima}`, `0/${esperadas} cajas · ${numeroParte}`, 'ambar');
  }

  agregarCaja({ caja, numeroParte }) {
    const t = this.tarima;
    let c = FALLA.PASS;
    if (!t) c = FALLA.GATE_PREVIO_NO_PASS;
    else if (numeroParte !== t.numeroParte) c = FALLA.SKU_NO_COINCIDE; // la etiqueta de la caja trae el número de parte
    else if (!this.ingresadas.has(caja)) c = FALLA.GATE_PREVIO_NO_PASS;
    else if (t.cajas.includes(caja)) c = FALLA.DUPLICADO;
    if (!c) t.cajas.push(caja);
    this.mostrar(`Tarima ${t?.id}`, c ? `${texto(c)} (${caja})` : `${t.cajas.length}/${t.esperadas} cajas`, c ? 'rojo' : 'ambar');
    return this.emitir(14, c, { tarima: t?.id, caja, orden: t?.orden, numeroParte, cantidad: t?.cajas.length ?? 0, operador: t?.almacenista });
  }

  cerrarTarima() {
    const t = this.tarima;
    const c = t && t.cajas.length === t.esperadas ? FALLA.PASS : FALLA.TARIMA_INCOMPLETA;
    this.mostrar(`Tarima ${t?.id}`, c ? texto(c) : 'Flejada · lista para etiquetar', c ? 'rojo' : 'verde');
    const r = this.emitir(14, c, { tarima: t?.id, orden: t?.orden, numeroParte: t?.numeroParte, cantidad: t?.cajas.length ?? 0, total: t?.esperadas, cierre: 1, operador: t?.almacenista });
    if (!c) this.tarima = null;
    return r;
  }
}

// ───────────────────────── CP 15–16 · Visión cenital y puerta de embarque ─────────────────────────
export class NodoVision extends Nodo {
  constructor(o) {
    super({ ...o, tipo: 'vision' });
    this.caras = new Map(); // tarima → [bool x4]
    this.matriz = { tarima: null, caras: [false, false, false, false] };
    this.mostrar(this.nombre, 'Semáforo en espera', 'gris');
  }

  // CP 15: una cara de la tarima (escáner + cámara)
  escanearCara({ tarima, cara, camaraOk }) {
    if (!this.caras.has(tarima)) this.caras.set(tarima, [false, false, false, false]);
    const caras = this.caras.get(tarima);
    const c = camaraOk ? FALLA.PASS : FALLA.CAMARA_NO_CONFIRMA;
    if (!c) caras[cara - 1] = true;
    const n = caras.filter(Boolean).length;
    this.matriz = { tarima, caras: [...caras] };
    const simbolos = caras.map((x) => (x ? 'o' : 'x')).join(' ');
    this.mostrar(`Tarima ${tarima}`, c ? `${texto(c)} · ${simbolos}` : `${simbolos} → ${n}/4`, c ? 'rojo' : n === 4 ? 'verde' : 'ambar');
    return this.emitir(15, c, { tarima, cara, camara: camaraOk ? 1 : 0, cantidad: n });
  }

  // CP 16: despacho
  despachar({ tarima, puerta }) {
    const n = (this.caras.get(tarima) || []).filter(Boolean).length;
    const c = n === 4 ? FALLA.PASS : FALLA.TARIMA_INCOMPLETA;
    this.mostrar(`Tarima ${tarima}`, c ? texto(c) : `Despachada por ${puerta}`, c ? 'rojo' : 'verde');
    if (!c) this.caras.delete(tarima);
    return this.emitir(16, c, { tarima, puerta, cantidad: n });
  }

  vista() {
    return { ...super.vista(), matriz: this.matriz };
  }
}
