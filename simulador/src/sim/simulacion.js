// Motor de escenarios: hace el papel de las personas en planta (almacenistas, operadores,
// inspectores, charoleros...). Solo "escanea" en los nodos y hace acciones de oficina en el MES;
// nunca toca la base de datos directamente.
import { azar, elegir, normal, Turno } from '../reloj.js';
import { PRODUCTOS, PROVEEDORES, PERSONAL, operadoresDe, FALLAS } from './catalogo.js';
import { idBolsa } from '../ids.js';

const FASES = { planificacion: 'planificando la OT (CP 01–03)', resina: 'preparando resina (CP 04)', liberacion: 'esperando el sobre de OT (CP 05)', produccion: 'en producción (CP 06–07)', cierre: 'esperando retiro de charolas (CP 08–10)', terminada: 'OT terminada' };

export class Simulacion {
  constructor({ reloj, mes, canal, nodos, cfg }) {
    Object.assign(this, { reloj, mes, canal, nodos, cfg });
    this.activa = false;
    this.fallas = []; // fallas inyectadas desde el panel, se consumen una vez
    this.lotes = new Map(); // sku → { lote, kg }
    this.preparandoResina = new Map();
    this.turnos = { mp: new Turno(), mez: new Turno(cfg.operadoresResina), vis: new Turno() };
    this.mesas = nodos.sm1.map((nodo) => ({ nodo, turno: new Turno(), cola: 0 })); // mesas de SM1
    // Cada puesto de PT es una zona de pre-envío con su terminal: la OT entra (CP 13) y se paletiza (CP 14)
    // en la misma zona, porque el gate local de CP 14 solo conoce las cajas que esa terminal registró
    this.puestosPT = nodos.pts.map((nodo, i) => ({ nodo, letra: 'ABCDEFGH'[i], ingreso: new Turno(), turno: new Turno() }));
    this.otsActivas = new Map(); // ot → producto
    this.maquinas = new Map(); // inyectora → OT en curso
    this.manual = new Set(); // inyectoras controladas desde el panel
    this.solicitudOT = new Set();
    this.bitacora = [];
  }

  log(texto) {
    this.bitacora.unshift({ ts: this.reloj.iso(), texto });
    this.bitacora.length = Math.min(this.bitacora.length, 60);
  }

  inyectar(tipo, maquina = null) {
    if (!FALLAS[tipo]) return false;
    this.fallas.push({ tipo, maquina });
    this.log(`Falla programada: ${FALLAS[tipo].texto}${maquina ? ` en ${maquina}` : ''}`);
    return true;
  }

  falla(tipo, maquina = null) {
    const i = this.fallas.findIndex((f) => f.tipo === tipo && (!f.maquina || !maquina || f.maquina === maquina));
    if (i >= 0) {
      this.fallas.splice(i, 1);
      return true;
    }
    return Math.random() < this.cfg.tasaFallasAleatorias / 10;
  }

  esperar(min, max = min) {
    return this.reloj.esperar(azar(min, max) * 1000);
  }

  iniciar() {
    this.activa = true;
    this.nodos.inyectoras.forEach((n, i) => this.reloj.timeout(() => this.cicloMaquina(n, i + 1).catch((e) => console.error(n.nombre, e)), i * azar(8000, 20000)));
  }

  detener() {
    this.activa = false;
  }

  // ───────────── CP 01–02: tener resina aprobada en la mezanina ─────────────
  // rapido: la máquina en modo manual no hace fila en almacén MP (si se acabó el lote, se le surte uno de inmediato)
  asegurarResina(sku, kg, rapido = false) {
    const l = this.lotes.get(sku);
    if (l && l.kg >= kg) {
      l.kg -= kg;
      return Promise.resolve(l.lote);
    }
    if (rapido) return this.recibirYSubirLote(sku, true).then(() => this.asegurarResina(sku, kg, true));
    if (!this.preparandoResina.has(sku)) {
      const p = this.turnos.mp
        .run(() => this.recibirYSubirLote(sku))
        .finally(() => this.preparandoResina.delete(sku));
      this.preparandoResina.set(sku, p);
    }
    return this.preparandoResina.get(sku).then(() => this.asegurarResina(sku, kg));
  }

  // Tiempos de las personas alrededor de la máquina: en modo manual van rápido para no hacer esperar a quien prueba
  ritmo(nodo, [min, max]) {
    return this.manual.has(nodo.nombre) ? [Math.min(5, min), Math.min(15, max)] : [min, max];
  }

  async recibirYSubirLote(sku, rapido = false) {
    const mp = this.nodos.mp;
    for (;;) {
      const lote = this.mes.nuevoLote();
      const certificado = !this.falla('certificado');
      await this.esperar(rapido ? 10 : 60, rapido ? 20 : 180);
      const r = mp.recibirLote({ lote, sku, proveedor: elegir(PROVEEDORES), kg: 500, certificado, almacenista: elegir(PERSONAL.almacenMP) });
      if (!r.ok) {
        this.log(`CP01 ${lote} rechazado: ${r.texto}. Se recibe otro lote.`);
        continue;
      }
      await this.esperar(rapido ? 10 : 120, rapido ? 20 : 300);
      mp.trasladar({ lote, ubicacion: 'MEZ-2P', almacenista: elegir(PERSONAL.almacenMP) });
      // el MES debe ver el lote en mezanina antes de programar (CP 03 depende de esto)
      while (!this.mes.loteEnMezanina(sku)) await this.reloj.esperar(5000);
      this.lotes.set(sku, { lote, kg: 500 });
      return lote;
    }
  }

  // ───────────── ciclo de una inyectora: una OT tras otra ─────────────
  // Cada paso respeta el modo manual: si una persona tomó la terminal desde el panel,
  // el ciclo automático se detiene y espera.
  async cicloMaquina(nodo, num) {
    while (this.activa) {
      await this.esperarTurnoAutomatico(nodo);
      const st = await this.prepararOT(nodo, num);
      if (!st) continue;
      await this.producir(nodo, st);
      if (st.cancelada) {
        // Reiniciada desde el panel: las charolas ya llenas siguen su camino; la OT se cancela y la máquina pide otra
        await this.mes.cancelarOT(st.ot);
        st.fase = 'terminada';
        this.log(`${nodo.nombre}: OT ${st.ot} cancelada desde el panel`);
        continue;
      }
      await this.terminarOT(nodo, st);
      if (!this.manual.has(nodo.nombre)) await this.esperar(180, 420); // cambio de molde
    }
  }

  // En manual, la máquina solo arranca una OT nueva cuando la persona la pide
  async esperarTurnoAutomatico(nodo) {
    while (this.manual.has(nodo.nombre) && !this.solicitudOT.has(nodo.nombre)) await this.reloj.esperar(2000);
    this.solicitudOT.delete(nodo.nombre);
    this.maquinas.set(nodo.nombre, { ot: null, fase: 'planificacion', charolas: [] });
  }

  // CP 01–05
  async prepararOT(nodo, num) {
    const operadores = operadoresDe(num);
    const producto = elegir(PRODUCTOS);
    const total = this.cfg.bolsasPorOT;
    const manual = () => this.manual.has(nodo.nombre);
    // Si toman el control mientras la máquina hace fila en almacén MP, se le surte de inmediato
    const kg = Math.ceil((total * producto.nominal) / 1000);
    let surtido = false;
    const enFila = this.asegurarResina(producto.skuResina, kg, manual()).finally(() => (surtido = true));
    const prioridad = (async () => {
      while (!surtido && !manual()) await this.reloj.esperar(2000);
      return surtido ? enFila : this.asegurarResina(producto.skuResina, kg, true);
    })();
    const lote = await Promise.race([enFila, prioridad]);

    // CP 03 · planificación
    const { ok, ot } = await this.mes.crearOT({ maquina: nodo.nombre, producto, total });
    if (!ok) {
      this.maquinas.delete(nodo.nombre);
      await this.esperar(60);
      return null;
    }
    this.otsActivas.set(ot, producto);
    const st = { ot, producto, total, operadores, num, charolas: [], fase: 'resina' };
    this.maquinas.set(nodo.nombre, st);

    // CP 04 · carga de resina en la mezanina (la máquina manual tiene prioridad: no hace fila)
    const turnoMez = manual() ? (fn) => fn() : (fn) => this.turnos.mez.run(fn);
    await turnoMez(async () => {
      await this.esperar(manual() ? 5 : 60, manual() ? 15 : 150);
      const embudo = nodo.nombre.replace('INY', 'EMB');
      const operador = elegir(PERSONAL.resina);
      if (this.falla('resina', nodo.nombre)) {
        const otra = elegir(PRODUCTOS.filter((p) => p.skuResina !== producto.skuResina)).skuResina;
        const r = this.nodos.mez.cargarResina({ ot, lote: `LMP-X-${otra}`, skuResina: otra, embudo, operador });
        this.log(`CP04 ${ot}: ${r.texto}. Vaciado bloqueado.`);
        await this.esperar(90, 180);
      }
      this.nodos.mez.cargarResina({ ot, lote, skuResina: producto.skuResina, embudo, operador });
    });

    // CP 05 · liberación del sobre (el MES carga la OT en la terminal por LoRa)
    st.fase = 'liberacion';
    await this.esperar(manual() ? 5 : 120, manual() ? 15 : 300);
    await this.mes.liberarOT({ ot, operadores, supervisor: elegir(PERSONAL.supervisores) });
    while (nodo.ot !== ot) await this.reloj.esperar(2000);
    st.fase = 'produccion';
    return st;
  }

  // CP 06–07
  async producir(nodo, st) {
    for (;;) {
      if (st.cancelada) return;
      if (nodo.ot === st.ot && nodo.siguiente > st.total) return;
      if (this.manual.has(nodo.nombre)) {
        await this.reloj.esperar(2000);
        continue;
      }
      if (!nodo.arrancada || nodo.bloqueado) {
        await this.arranqueAutomatico(nodo, st);
        continue;
      }
      const k = nodo.siguiente;
      await this.reloj.esperar(this.cfg.intervaloBolsaMs * azar(0.8, 1.2));
      if (this.manual.has(nodo.nombre) || nodo.siguiente !== k) continue;
      let peso = Math.round(normal(st.producto.nominal, st.producto.tol / 4));
      if (this.falla('secuencia', nodo.nombre)) {
        const r = nodo.registrarBolsa({ k: k + 1, peso });
        this.log(`CP07 ${nodo.nombre}: ${r.texto}. Se corrige la etiqueta.`);
        await this.esperar(15, 40);
      }
      if (this.falla('peso', nodo.nombre)) peso = st.producto.nominal + Math.round(st.producto.tol * azar(1.6, 3));
      let r = nodo.registrarBolsa({ k, peso });
      while (!r.ok && !this.manual.has(nodo.nombre)) {
        await this.esperar(20, 60); // ajuste de tara / conteo
        r = nodo.registrarBolsa({ k, peso: Math.round(normal(st.producto.nominal, st.producto.tol / 5)) });
      }
      if (r.ok) this.trasBolsa(nodo, k);
    }
  }

  async arranqueAutomatico(nodo, st) {
    if (nodo.bloqueado) {
      this.log(`CP06 ${nodo.nombre}: terminal bloqueada. Andon rojo, se llama al supervisor.`);
      await this.esperar(120, 300);
      await this.mes.desbloquear(nodo.nombre);
      return;
    }
    await this.esperar(60, 120);
    if (this.manual.has(nodo.nombre) || nodo.arrancada) return;
    let gafete = elegir(st.operadores);
    let qr = nodo.qr;
    if (this.falla('operador', nodo.nombre)) gafete = 'E9999';
    else if (this.falla('qr', nodo.nombre)) qr = this.vecina(nodo).qr;
    const r = nodo.arrancar({ gafete, ot: st.ot, qr });
    if (!r.ok) this.log(`CP06 ${nodo.nombre}: ${r.texto}.`);
  }

  // Después de cada bolsa correcta (automática o escaneada a mano): si se llenó una charola, sale hacia SM1
  trasBolsa(nodo, k) {
    const st = this.maquinas.get(nodo.nombre);
    const porCharola = this.cfg.bolsasPorCaja;
    if (!st || k % porCharola !== 0) return;
    const ks = Array.from({ length: porCharola }, (_, i) => k - porCharola + 1 + i);
    st.charolas.push(this.flujoCharola(nodo, st.ot, k / porCharola, ks, st.producto));
  }

  // La OT se cierra en la máquina cuando la última charola salió (CP 10);
  // después sigue su camino (cajas → tarima) mientras la máquina pasa a la siguiente OT
  async terminarOT(nodo, st) {
    st.fase = 'cierre';
    await Promise.all(st.charolas.map((c) => c.retirada));
    Promise.all(st.charolas.map((c) => c.caja))
      .then((cajas) => this.flujoTarima(st.ot, cajas, st.producto))
      .catch((e) => console.error(st.ot, e));
    await this.esperar(...this.ritmo(nodo, [30, 90]));
    await this.mes.cerrarOT(st.ot);
    st.fase = 'terminada';
  }

  // ───────────── modo manual (terminal virtual del panel) ─────────────
  puestoPT(ot) {
    return this.puestosPT[Number(ot.slice(-3)) % this.puestosPT.length];
  }

  // La máquina de al lado en la misma línea (para la falla de QR equivocado)
  vecina(nodo) {
    const misma = this.nodos.inyectoras.filter((n) => n.linea === nodo.linea);
    return misma[(misma.indexOf(nodo) + 1) % misma.length];
  }

  inyectora(nombre) {
    return this.nodos.inyectoras.find((n) => n.nombre === nombre);
  }

  tomarControl(nombre) {
    if (!this.inyectora(nombre)) return { ok: false, mensaje: 'No existe esa inyectora' };
    this.manual.add(nombre);
    this.log(`${nombre} en modo manual desde el panel`);
    return { ok: true, mensaje: `${nombre} en modo manual. El ciclo automático de esta máquina queda en pausa.` };
  }

  soltarControl(nombre) {
    this.manual.delete(nombre);
    this.solicitudOT.delete(nombre);
    this.log(`${nombre} regresa a modo automático`);
    return { ok: true, mensaje: `${nombre} regresa a modo automático` };
  }

  pedirOT(nombre) {
    if (!this.manual.has(nombre)) return { ok: false, mensaje: 'Tome el control de la terminal primero' };
    const st = this.maquinas.get(nombre);
    if (this.solicitudOT.has(nombre)) return { ok: false, mensaje: 'Ya hay una OT solicitada' };
    if (st && st.fase !== 'terminada') return { ok: false, mensaje: `La OT ${st.ot ?? 'nueva'} sigue en curso (${FASES[st.fase] ?? st.fase})` };
    this.solicitudOT.add(nombre);
    return { ok: true, mensaje: 'OT solicitada: planificación (CP 03), resina (CP 04) y sobre (CP 05) en camino' };
  }

  // Cancela la OT en curso de una máquina en manual y pide otra (para repetir la demo desde la bolsa 1)
  reiniciarOT(nombre) {
    if (!this.manual.has(nombre)) return { ok: false, mensaje: 'Tome el control de la terminal primero' };
    const st = this.maquinas.get(nombre);
    if (st?.fase === 'cierre' || st?.fase === 'terminada') return { ok: false, mensaje: `La OT ${st.ot} ya está cerrando` };
    if (st?.fase !== 'produccion') return { ok: false, mensaje: `Espere: ${FASES[st?.fase] ?? 'preparando la OT'}. Cuando llegue a la terminal se puede reiniciar.` };
    if (st.cancelada) return { ok: false, mensaje: 'Ya se está reiniciando' };
    st.cancelada = true;
    this.solicitudOT.add(nombre);
    return { ok: true, mensaje: `OT ${st.ot} cancelada. La nueva OT llega a la terminal en unos segundos.` };
  }

  escanearManual(nombre, codigo) {
    const nodo = this.inyectora(nombre);
    if (nodo?.placaReal) return { ok: false, mensaje: `${nombre} es una placa física: escanee con el lector conectado a la placa` };
    if (!nodo) return { ok: false, mensaje: 'No existe esa inyectora' };
    if (!this.manual.has(nombre)) return { ok: false, mensaje: 'Tome el control de la terminal primero' };
    const antes = nodo.siguiente;
    const r = nodo.escanear(codigo);
    if (r.evento?.ok && r.evento.cp === 7) this.trasBolsa(nodo, antes);
    return { ok: true, ...r };
  }

  desbloquearManual(nombre) {
    const nodo = this.inyectora(nombre);
    if (!nodo || !this.manual.has(nombre)) return { ok: false, mensaje: 'Tome el control de la terminal primero' };
    if (!nodo.bloqueado) return { ok: false, mensaje: 'La terminal no está bloqueada' };
    this.mes.desbloquear(nombre).then(() => this.log(nombre + ': supervisor desbloqueó la terminal'));
    return { ok: true, mensaje: 'El supervisor desbloquea desde el MES: el comando DESBLOQUEAR viaja por LoRa a la terminal' };
  }

  pesarManual(nombre, gramos) {
    const nodo = this.inyectora(nombre);
    if (nodo?.placaReal) return { ok: false, mensaje: `${nombre} es una placa física: escanee con el lector conectado a la placa` };
    if (!nodo || !this.manual.has(nombre)) return { ok: false, mensaje: 'Tome el control de la terminal primero' };
    nodo.pesar(gramos);
    return { ok: true, mensaje: `Báscula: ${Math.round(gramos)} g` };
  }

  // Etiquetas que tendría la persona a la mano junto a la máquina
  etiquetas(nombre) {
    const nodo = this.inyectora(nombre);
    if (!nodo) return null;
    const st = this.maquinas.get(nombre);
    const num = this.nodos.inyectoras.indexOf(nodo) + 1;
    const vecina = this.vecina(nodo).qr;
    const otraOT = [...this.otsActivas.keys()].find((o) => o !== nodo.ot);
    const grupos = [];
    grupos.push({ titulo: 'Gafetes', items: [...operadoresDe(num).map((g) => ({ codigo: g, nota: 'habilitado' })), { codigo: 'E9999', nota: 'no habilitado', malo: true }] });
    if (nodo.ot) grupos.push({ titulo: 'Carpeta de la OT', items: [{ codigo: nodo.ot, nota: st?.producto?.descripcion ?? 'OT cargada' }, ...(otraOT ? [{ codigo: otraOT, nota: 'OT de otra máquina', malo: true }] : [])] });
    grupos.push({ titulo: 'QR fijo de la máquina', items: [{ codigo: nodo.qr, nota: 'esta máquina' }, { codigo: vecina, nota: 'máquina vecina', malo: true }] });
    if (nodo.ot && nodo.cfgOT) {
      const k = nodo.siguiente;
      const items = [];
      if (k <= nodo.cfgOT.total) items.push({ codigo: idBolsa(nodo.ot, k), nota: `siguiente, ${k} de ${nodo.cfgOT.total}` });
      if (k + 1 <= nodo.cfgOT.total) items.push({ codigo: idBolsa(nodo.ot, k + 1), nota: 'se salta una', malo: true });
      if (otraOT) items.push({ codigo: idBolsa(otraOT, 1), nota: 'de otra OT', malo: true });
      if (items.length) grupos.push({ titulo: 'Etiquetas correlativas del sobre', items });
    }
    return {
      maquina: nombre,
      manual: this.manual.has(nombre),
      fase: FASES[st?.fase] ?? 'sin OT',
      // Para el recorrido guiado del panel: en qué paso exacto va la máquina
      faseClave: st?.fase ?? null,
      solicitada: this.solicitudOT.has(nombre),
      arrancada: !!nodo.arrancada,
      siguiente: nodo.cfgOT ? nodo.siguiente : null,
      totalBolsas: nodo.cfgOT?.total ?? st?.total ?? null,
      bolsasPorCharola: this.cfg.bolsasPorCaja,
      qr: nodo.qr,
      puedePedirOT: this.manual.has(nombre) && (!st || st.fase === 'terminada') && !this.solicitudOT.has(nombre),
      otEnCurso: st?.ot ?? null,
      ayuda: !this.manual.has(nombre)
        ? 'Presione "Tomar el control" para usar esta terminal.'
        : this.solicitudOT.has(nombre) || (st && ['planificacion', 'resina', 'liberacion'].includes(st.fase))
          ? `Ya viene una OT${st?.ot ? ` (${st.ot})` : ''} en camino: espere a que la pantalla pida gafete, OT y QR. No hace falta pedir otra.`
          : st?.fase === 'cierre'
            ? 'Todas las bolsas están listas. Espere a que se retiren las charolas (CP 08–10) para pedir otra OT.'
            : !st || st.fase === 'terminada'
              ? 'Sin OT en curso: presione "Pedir OT nueva".'
              : nodo.bloqueado
                ? 'Terminal bloqueada: presione "Llamar al supervisor".'
                : !nodo.arrancada
                  ? 'Escanee en orden: gafete, OT y QR de la máquina.'
                  : 'Pese la bolsa y escanee su etiqueta correlativa.',
      ot: nodo.ot ?? st?.ot ?? null,
      producto: st?.producto ?? null,
      bloqueado: nodo.bloqueado,
      bascula: nodo.cfgOT ? { nominal: nodo.cfgOT.nominal, tol: nodo.cfgOT.tol } : null,
      grupos,
    };
  }

  // ───────────── CP 08–13: de la charola a la caja en pre-envío ─────────────
  flujoCharola(nodo, ot, charola, ks, producto) {
    let avisarRetiro;
    const retirada = new Promise((r) => (avisarRetiro = r));
    const caja = this.recorrerCharola(nodo, ot, charola, ks, producto, avisarRetiro);
    caja.catch((e) => console.error(ot, e));
    return { retirada, caja };
  }

  async recorrerCharola(nodo, ot, charola, ks, producto, avisarRetiro) {
    // CP 08 · Inspector 1
    await this.esperar(...this.ritmo(nodo, [30, 120]));
    const muestra = elegir(ks);
    const inspector = elegir(PERSONAL.inspectores1);
    let r = nodo.ot === ot ? nodo.inspeccionar({ k: muestra, inspector, defecto: this.falla('defecto', nodo.nombre) }) : { ok: true };
    if (!r.ok) {
      this.log(`CP08 ${ot} charola ${charola}: ${r.texto}. Cuarentena TEP y retrabajo.`);
      await this.esperar(300, 600);
      if (nodo.ot === ot) nodo.inspeccionar({ k: muestra, inspector, defecto: false });
    }

    // CP 09 · Supervisor libera
    await this.esperar(...this.ritmo(nodo, [30, 150]));
    if (nodo.ot === ot) nodo.liberarCharola({ charola, supervisor: elegir(PERSONAL.supervisores) });

    // CP 10 · Charolero retira
    await this.esperar(...this.ritmo(nodo, [60, 240]));
    const charolero = elegir(PERSONAL.charoleros);
    if (this.falla('saltoCP10', nodo.nombre)) this.log(`CP10 omitido: ${ot} charola ${charola} sale sin registro.`);
    else if (nodo.ot === ot) nodo.retirarCharola({ charola, charolero });
    avisarRetiro();
    await this.esperar(60, 180); // traslado en carrito

    // CP 11–12 · SM1 (la mesa con menos charolas en espera)
    const mesa = this.mesas.reduce((a, b) => (b.cola < a.cola ? b : a));
    mesa.cola++;
    const caja = await mesa.turno.run(async () => {
      const sm1 = mesa.nodo;
      const caja = this.mes.nuevaCaja();
      sm1.abrirCaja({ caja, ot, charolero, capacidad: ks.length });
      for (const k of ks) {
        await this.esperar(2, 5);
        if (this.falla('bolsaAjena')) {
          const otra = [...this.otsActivas.keys()].find((o) => o !== ot) ?? 'OT-2611-000';
          r = sm1.escanearBolsa({ ot: otra, k: 1 });
          this.log(`CP11 ${caja}: ${r.texto} (${idBolsa(otra, 1)}). Pantalla AV en rojo.`);
          await this.esperar(5, 15);
        }
        sm1.escanearBolsa({ ot, k });
        if (this.falla('duplicada')) {
          await this.esperar(3, 6);
          r = sm1.escanearBolsa({ ot, k });
          this.log(`CP11 ${caja}: ${r.texto} (${idBolsa(ot, k)}).`);
        }
      }
      // CP 12 · Inspector 2
      await this.esperar(8, 20);
      const inspector = elegir(PERSONAL.inspector2);
      r = sm1.cerrarCaja({ inspector, encintada: !this.falla('sinCinta') });
      if (!r.ok) {
        this.log(`CP12 ${caja}: ${r.texto}. Se regresa a encintar.`);
        await this.esperar(15, 30);
        sm1.cerrarCaja({ inspector, encintada: true });
      }
      return caja;
    });
    mesa.cola--;

    // CP 13 · Pre-envío
    await this.esperar(60, 240);
    const zona = this.puestoPT(ot);
    await zona.ingreso.run(async () => {
      zona.nodo.ingresarCaja({ caja, ot, ubicacion: `PRE-${zona.letra}${Math.ceil(azar(0, 9))}`, almacenista: elegir(PERSONAL.almacenPT) });
      await this.esperar(3, 8);
    });
    return caja;
  }

  // ───────────── CP 14–16: tarima, visión y despacho ─────────────
  // PT y la cámara atienden a todas las inyectoras en fila: cada tarima debe tardar menos de lo que la planta
  // tarda en terminar otra OT (~1 por minuto), o la fila de pre-envío crece sin fin.
  async flujoTarima(ot, cajas, producto) {
    await this.esperar(120, 400);
    const tarima = this.mes.nuevaTarima();
    const orden = this.mes.nuevaOrdenEmbarque();
    const puesto = this.puestoPT(ot);
    await puesto.turno.run(async () => {
      const pt = puesto.nodo;
      pt.iniciarTarima({ tarima, orden, numeroParte: producto.sku, esperadas: cajas.length, almacenista: elegir(PERSONAL.almacenPT) });
      for (const caja of cajas) {
        await this.esperar(4, 8);
        if (this.falla('skuAjeno')) {
          const otro = elegir(PRODUCTOS.filter((p) => p.sku !== producto.sku)).sku;
          const r = pt.agregarCaja({ caja: 'CJ-999999', numeroParte: otro });
          this.log(`CP14 ${tarima}: ${r.texto} (${otro}). Se retira la caja.`);
          await this.esperar(20, 40);
        }
        pt.agregarCaja({ caja, numeroParte: producto.sku });
      }
      await this.esperar(15, 30); // flejado
      pt.cerrarTarima();
    });

    await this.esperar(60, 180); // traslado a la zona de cámara
    await this.turnos.vis.run(async () => {
      const vis = this.nodos.vis;
      for (let cara = 1; cara <= 4; cara++) {
        await this.esperar(2, 4);
        let r = vis.escanearCara({ tarima, cara, camaraOk: !this.falla('camara') });
        while (!r.ok) {
          this.log(`CP15 ${tarima} cara ${cara}: ${r.texto}. Semáforo ámbar, re-escaneo.`);
          await this.esperar(15, 30);
          r = vis.escanearCara({ tarima, cara, camaraOk: true });
        }
      }
      await this.esperar(5, 10);
      vis.despachar({ tarima, puerta: `P-${Math.ceil(azar(0, 6))}` });
    });
    this.otsActivas.delete(ot);
    this.log(`CP16 ${tarima} (${ot}) despachada.`);
  }
}
