import * as manual from './terminal.js';
import { $, h, hora, segmentar, dibujarSegmentos, LEYENDA_TRAMA } from './comun.js';

// Panel del simulador. Recibe por SSE: estado (cada ~0.8 s), aire (cada trama LoRa),
// traza (cada traducción del puente) y mqtt (cada mensaje del broker).

const CP = [
  [1, 'Recepción MP', 'mp'], [2, 'Subida a mezanina', 'mp'], [3, 'Planificación de OT', 'plan'], [4, 'Resina en embudo', 'plan'],
  [5, 'Sobre de OT', 'prod'], [6, 'Arranque de inyectora', 'prod'], [7, 'Moldeo y embolsado', 'prod'], [8, 'Inspección TEP 1', 'cal1'],
  [9, 'Liberación de charolas', 'prod'], [10, 'Traslado a SM1', 'charolero'], [11, 'Empaque en caja', 'charolero'], [12, 'Cierre de caja', 'pt'],
  [13, 'Pre-envío', 'pt'], [14, 'Paletizado', 'pt'], [15, 'Visión de tarima', 'pt'], [16, 'Despacho', 'pt'],
];
const COLOR_ROL = { mp: 'var(--rol-mp)', plan: 'var(--rol-plan)', prod: 'var(--rol-prod)', cal1: 'var(--rol-cal1)', charolero: 'var(--rol-charolero)', pt: 'var(--rol-pt)' };
const ROL_ESTACION = {
  almacen_mp: 'Almacén MP · CP 01–02', mezanina: 'Operador de resina, 2do piso · CP 04', sm1: 'Charolero e Inspector 2 · CP 11–12',
  almacen_pt: 'Almacén PT · CP 13–14', vision: 'Cámara cenital y embarque · CP 15–16',
};

let meta = null;
const ui = { maquinas: new Map(), estaciones: new Map(), cpCuenta: new Map() };

// ───────────── franja de CP ─────────────
function armarFlujo() {
  const ol = $('#flujo');
  for (const [n, nombre, rol] of CP) {
    const cuenta = h('span', { class: 'cuenta', text: '0' });
    const li = h('li', { style: `background:${COLOR_ROL[rol]}`, title: `CP ${String(n).padStart(2, '0')} · ${nombre}` },
      h('span', { class: 'cp', text: `CP ${String(n).padStart(2, '0')}` }), h('span', { class: 'nombre', text: nombre }), cuenta);
    ui.cpCuenta.set(n, { li, cuenta, total: -1 });
    ol.append(li);
  }
}
function actualizarFlujo(porCP) {
  for (const [n, x] of ui.cpCuenta) {
    const v = porCP[n] ?? { pass: 0, fail: 0 };
    const total = v.pass + v.fail;
    x.cuenta.replaceChildren(String(v.pass), v.fail ? h('span', { class: 'f', text: ` · ${v.fail} fallas` }) : '');
    x.li.classList.toggle('pulso', x.total >= 0 && total > x.total);
    x.total = total;
  }
}

// ───────────── terminales ─────────────
function terminal(n) {
  const l1 = h('div'), l2 = h('div'), senal = h('span', { class: 'senal' }), barra = h('i'), pieIzq = h('span'), pieDer = h('span');
  const el = h('article', { class: 'term' },
    h('div', { class: 'term-cab' }, h('span', { class: 'baliza', 'aria-hidden': 'true' }), h('strong', { text: n.nombre }), senal),
    h('div', { class: 'oled' }, l1, l2),
    n.tipo === 'inyectora' ? h('div', { class: 'progreso' }, barra) : null,
    h('div', { class: 'term-pie' }, pieIzq, pieDer));
  return { el, l1, l2, senal, barra, pieIzq, pieDer };
}
function pintarTerminal(t, n) {
  t.el.dataset.color = n.pantalla.color;
  t.l1.textContent = n.pantalla.l1;
  t.l2.textContent = n.pantalla.l2;
  t.senal.textContent = n.sinSenal ? 'sin señal' : `${n.rssi} dBm`;
  t.senal.classList.toggle('mala', n.sinSenal || !n.conEnlace);
  if (t.barra && n.total) t.barra.style.width = `${(100 * n.bolsa) / n.total}%`;
  else if (t.barra) t.barra.style.width = '0';
  t.pieIzq.textContent = `${n.stats.pass} correctos · ${n.stats.fail} fallas`;
  t.pieDer.textContent = n.bufer ? `${n.bufer} en búfer` : '';
  t.pieDer.className = n.bufer > 1 ? 'bufer' : '';
}
function actualizarNodos(nodos) {
  for (const n of nodos) {
    if (n.tipo === 'inyectora') {
      if (!ui.maquinas.has(n.nombre)) {
        const t = terminal(n);
        ui.maquinas.set(n.nombre, t);
        $('#maquinas').append(t.el);
      }
      pintarTerminal(ui.maquinas.get(n.nombre), n);
      continue;
    }
    if (!ui.estaciones.has(n.nombre)) {
      const t = terminal(n);
      t.el.classList.add('estacion');
      t.el.insertBefore(h('div', { class: 'rol', text: ROL_ESTACION[n.tipo] ?? '' }), t.el.children[1]);
      if (n.tipo === 'sm1') {
        t.av = h('div', { class: 'av', 'aria-label': 'Pantalla AV: divisiones de la caja' });
        t.avAlerta = h('div', { class: 'av-alerta' });
        t.el.insertBefore(t.av, t.el.lastChild);
        t.el.insertBefore(t.avAlerta, t.el.lastChild);
      }
      if (n.tipo === 'vision') {
        t.matriz = h('div', { class: 'matriz', 'aria-label': 'Semáforo de caras de la tarima' });
        t.el.insertBefore(t.matriz, t.el.lastChild);
      }
      ui.estaciones.set(n.nombre, t);
      $('#estaciones').append(t.el);
    }
    const t = ui.estaciones.get(n.nombre);
    pintarTerminal(t, n);
    if (t.av) {
      const divs = n.av.divisiones.length ? n.av.divisiones : [null, null, null, null];
      t.av.replaceChildren(...divs.map((d, i) => h('span', { class: d ? 'llena' : '', text: `${i + 1}/${divs.length}`, title: d ?? 'vacía' })));
      t.avAlerta.textContent = n.av.alerta ?? '';
    }
    if (t.matriz) {
      const c = n.matriz.caras;
      t.matriz.replaceChildren(...c.map((x) => h('span', { class: x ? 'o' : '', text: x ? 'o' : 'x' })), h('span', { class: 'lectura', text: `${c.filter(Boolean).length}/4` }));
    }
  }
}

// ───────────── alertas, bitácora, indicadores ─────────────
function actualizarAlertas(mes) {
  const ul = $('#alertas');
  const items = [
    ...mes.pendientes.map((p) => h('li', { class: 'pend', 'data-nivel': 'ambar' },
      h('span', { class: 'hora', text: `${Math.max(0, p.venceEnS)} s` }), h('span', { class: 'cpx', text: `CP ${p.cp}` }),
      h('span', {}, 'En espera de conciliar: ', p.descripcion))),
    ...mes.alertas.map((a) => h('li', { 'data-nivel': a.nivel },
      h('span', { class: 'hora', text: hora(a.ts) }), h('span', { class: 'cpx', text: `CP ${a.cp}` }),
      h('span', {}, a.mensaje, a.origen === 'mes' ? h('span', { class: 'origen-mes', text: 'gate central MES' }) : null, h('div', { class: 'quien', text: [a.nodo, a.ot].filter(Boolean).join(' · ') })))),
  ];
  ul.replaceChildren(...(items.length ? items : [h('li', { class: 'vacio', text: 'Sin alertas. Programe una falla para ver cómo responde cada gate.' })]));
  $('#n-pendientes').textContent = mes.pendientes.length ? `${mes.pendientes.length} esperando eventos atrasados` : '';
}

function actualizarEstado(e) {
  $('#k-reloj').textContent = hora(e.reloj);
  $('#k-ocupacion').textContent = `${(e.radio.ocupacion * 100).toFixed(1)} %`;
  $('#k-colisiones').textContent = e.radio.tramas ? `${((100 * e.radio.colisiones) / e.radio.tramas).toFixed(1)} %` : '—';
  $('#k-eventos').textContent = e.mes.stats.eventos.toLocaleString('es-MX');
  $('#k-tarimas').textContent = e.mes.tarimasDespachadas;
  if (document.activeElement !== $('#vel')) {
    $('#vel').value = e.velocidad;
    $('#vel-out').textContent = `${e.velocidad}×`;
  }
  actualizarFlujo(e.mes.porCP);
  actualizarNodos(e.nodos);
  actualizarAlertas(e.mes);
  $('#bitacora').replaceChildren(...e.bitacora.map((b) => h('li', {}, h('time', { text: hora(b.ts) }), b.texto)));
  const r = e.radio, m = e.mes.stats, p = e.puente;
  $('#radio-stats').replaceChildren(...[
    ['Tramas', r.tramas], ['Correctas', r.ok], ['Colisiones', r.colisiones], ['Perdidas por ruido', r.perdidas], ['Sin señal', r.sinSenal],
    ['Publicadas en MQTT', p.publicadas], ['Duplicados descartados', m.duplicados], ['Eventos atrasados', m.diferidos], ['Conciliados', m.conciliados],
  ].map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v.toLocaleString('es-MX') }))));
  const tb = $('#tabla-ots tbody');
  tb.replaceChildren(...e.mes.otsRecientes.map((o) => {
    const tr = h('tr', {}, h('td', { text: o.ot }), h('td', { text: o.id_maquina }), h('td', { text: o.sku_producto }),
      h('td', {}, h('span', { class: `estado-ot ${o.estado}`, text: o.estado.replaceAll('_', ' ').toLowerCase() })),
      h('td', { text: `${o.bolsas}/${o.total_bolsas}` }), h('td', { text: o.cajas }), h('td', { text: o.despachadas }));
    tr.onclick = () => rastrear(o.ot);
    return tr;
  }));
}

// ───────────── traductor de tramas ─────────────

let ultimaTraza = 0;
function mostrarTraza(t) {
  if ($('#congelar').checked || !meta) return;
  if (t.topico.endsWith('/estado') && Date.now() - ultimaTraza < 8000) return; // prioriza eventos y comandos
  if (Date.now() - ultimaTraza < 2500) return; // legible: una trama cada 2.5 s
  ultimaTraza = Date.now();
  const segs = segmentar(t.hex, meta);
  $('#tr-meta').replaceChildren(
    t.dir === 'subida' ? 'Subida (nodo → gateway): ' : 'Bajada (MQTT → nodo): ',
    h('b', { text: `${t.bytes} bytes` }), ` por radio, recibida a las ${hora(t.ts)}.`,
    t.dir === 'subida' ? ' El puente verificó la firma, la convirtió a JSON y la publicó en:' : ' El MES publicó este comando y el puente lo codificó así:');
  $('#tr-bytes').replaceChildren(...dibujarSegmentos(segs));
  $('#tr-topico').textContent = t.topico;
  $('#tr-json').textContent = JSON.stringify(t.json, null, 2);
}
$('#tr-leyenda').replaceChildren(...LEYENDA_TRAMA.map(([c, t]) => h('li', {}, h('i', { style: `background:${c}` }), t)));

// ───────────── aire y MQTT ─────────────
const ESTADO_AIRE = { ok: 'recibida', colision: 'colisión', perdida: 'perdida', sin_senal: 'sin señal' };
function agregarAire(t) {
  const tb = $('#tabla-aire tbody');
  tb.prepend(h('tr', { class: t.estado },
    h('td', { text: hora(t.ts) }), h('td', { text: t.dir === 'subida' ? '↑ subida' : '↓ bajada' }), h('td', { text: t.nodo }), h('td', { text: t.tipo }),
    h('td', { text: t.bytes }), h('td', { text: t.airtimeMs }), h('td', { text: t.rssi }), h('td', { text: ESTADO_AIRE[t.estado] })));
  while (tb.children.length > 150) tb.lastChild.remove();
}
function agregarMQTT(m) {
  const filtro = $('#filtro-mqtt').value.trim();
  if (filtro && !m.topico.includes(filtro)) return;
  const ul = $('#mqtt');
  const cls = m.topico.startsWith('alerta') ? 'alerta' : m.topico.startsWith('erp') ? 'erp' : '';
  ul.prepend(h('li', {}, h('div', { class: `t ${cls}`, text: `${hora(m.ts)}  ${meta?.prefijo}/${m.topico}` }), h('div', { class: 'p', text: JSON.stringify(m.json) })));
  while (ul.children.length > 200) ul.lastChild.remove();
}

// ───────────── genealogía ─────────────
async function rastrear(id) {
  document.querySelector('[data-vista="traza"]').click();
  $('#q').value = id;
  const r = await fetch(`/api/genealogia?id=${encodeURIComponent(id)}`);
  const g = await r.json();
  const cont = $('#genealogia');
  if (!r.ok) return cont.replaceChildren(h('p', { class: 'vacio', text: `${g.error}: ${id}. Revise el formato, por ejemplo OT-2611-001-B004.` }));
  const foco = g.foco.id;
  const n = (cls, cod, estado, extra = '') => {
    const s = h('span', { class: `nodo-g ${cls}${cod === foco ? ' foco' : ''}` }, h('code', { text: cod }), h('span', { class: 'estado', text: [estado, extra].filter(Boolean).join(' · ') }));
    s.style.cursor = 'pointer';
    s.onclick = () => rastrear(cod);
    return s;
  };
  let arbol;
  if (g.foco.tipo === 'lote') {
    arbol = h('ul', { class: 'arbol' }, h('li', {}, n('lote', g.lote.id_lote, g.lote.estado.toLowerCase(), `${g.lote.sku_resina} · ${g.lote.proveedor}`),
      h('ul', {}, g.ots.map((o) => h('li', {}, n('ot', o.ot, o.estado.toLowerCase(), `${o.id_maquina} · ${o.sku_producto}`))))));
  } else {
    const o = g.orden;
    arbol = h('ul', { class: 'arbol' },
      ...g.lotes.map((l) => h('li', {}, n('lote', l.id_lote, l.sku_resina, `embudo ${l.id_embudo}`))),
      h('li', {}, n('ot', o.ot, o.estado.toLowerCase().replaceAll('_', ' '), `${o.id_maquina} · ${o.sku_producto} · molde ${o.id_molde}`),
        h('ul', {},
          ...g.cajas.map((c) => h('li', {}, n('caja', c.id_caja, c.estado.toLowerCase().replaceAll('_', ' '), `${c.total_bolsas}/${c.capacidad} bolsas`),
            h('ul', {}, ...c.bolsas.map((b) => h('li', {}, n('bolsa', b.id_bolsa, `${b.posicion}/${c.capacidad}`, b.peso_g ? `${b.peso_g} g` : 'sin registro de CP 07')))),
            c.tarima ? h('ul', {}, h('li', {}, n('tarima', c.tarima.id_tarima, c.tarima.estado.toLowerCase(), [c.tarima.orden_embarque, c.tarima.puerta].filter(Boolean).join(' · ')))) : null)),
          ...g.sinCaja.map((b) => h('li', {}, n('bolsa', b.id_bolsa, b.estado.toLowerCase().replaceAll('_', ' '), `${b.peso_g} g`))))));
  }
  const eventos = h('ol', { class: 'linea-tiempo' }, ...g.eventos.map((e) => {
    const rol = CP.find((c) => c[0] === e.cp)?.[2];
    const d = JSON.parse(e.datos || '{}');
    const det = Object.entries(d).filter(([k]) => !['ot'].includes(k)).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(',') : v}`).join(' · ');
    return h('li', {}, h('span', { class: 'cpx', style: `background:${COLOR_ROL[rol]}`, text: `CP${String(e.cp).padStart(2, '0')}` }),
      h('div', {}, h('span', { class: e.resultado === 'FAIL' ? 'fail' : '', text: `${hora(e.ts_nodo)} · ${e.nodo} · ${e.resultado === 'PASS' ? 'correcto' : e.codigo}` }),
        e.diferido ? h('span', { class: 'det', text: ' · llegó atrasado (búfer)' }) : null, h('div', { class: 'det', text: det })));
  }));
  cont.replaceChildren(h('section', { class: 'caja-panel' }, h('h2', { text: 'Genealogía' }), arbol),
    h('section', { class: 'caja-panel' }, h('h2', {}, 'Historial de eventos ', h('span', { class: 'nota', text: `${g.eventos.length} registros` })), eventos));
}
$('#form-busca').onsubmit = (ev) => {
  ev.preventDefault();
  if ($('#q').value.trim()) rastrear($('#q').value.trim());
};

// ───────────── controles ─────────────
const control = (cuerpo) => fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).then((r) => r.json());
$('#vel').oninput = (e) => ($('#vel-out').textContent = `${e.target.value}×`);
$('#vel').onchange = (e) => control({ accion: 'velocidad', valor: e.target.value });
$('#perd').oninput = (e) => ($('#perd-out').textContent = `${e.target.value} %`);
$('#perd').onchange = (e) => control({ accion: 'perdida', valor: e.target.value / 100 });
$('#int').oninput = (e) => ($('#int-out').textContent = `${e.target.value} s`);
$('#int').onchange = (e) => control({ accion: 'intervalo', valor: e.target.value * 1000 });
$('#form-falla').onsubmit = (e) => {
  e.preventDefault();
  control({ accion: 'falla', tipo: $('#sel-falla').value, maquina: $('#sel-maquina').value });
};
$('#form-senal').onsubmit = (e) => {
  e.preventDefault();
  control({ accion: 'sinSenal', nodo: $('#sel-nodo').value, segundos: Number($('#min-senal').value) * 60 });
};
for (const b of document.querySelectorAll('.pestanas button')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('.pestanas button')) x.setAttribute('aria-selected', String(x === b));
    for (const v of document.querySelectorAll('.vista')) v.hidden = v.id !== `vista-${b.dataset.vista}`;
  };
}

// ───────────── conexión ─────────────
armarFlujo();
const es = new EventSource('/api/stream');
es.addEventListener('inicio', (e) => {
  meta = JSON.parse(e.data);
  manual.configurar(meta);
  $('#mqtt-url').textContent = `${meta.mqtt} · ${meta.prefijo}/#`;
  $('#sel-falla').replaceChildren(...Object.entries(meta.fallas).map(([k, f]) => h('option', { value: k, text: `CP ${String(f.cp).padStart(2, '0')} · ${f.texto}` })));
});
let opcionesListas = false;
es.addEventListener('estado', (e) => {
  const est = JSON.parse(e.data);
  if (!opcionesListas) {
    opcionesListas = true;
    for (const n of est.nodos) {
      if (n.tipo === 'inyectora') $('#sel-maquina').append(h('option', { value: n.nombre, text: n.nombre }));
      $('#sel-nodo').append(h('option', { value: n.nombre, text: n.nombre }));
    }
    $('#int').value = est.intervaloBolsaMs / 1000;
    $('#int-out').textContent = `${est.intervaloBolsaMs / 1000} s`;
    $('#perd').value = Math.round(est.radio.perdidaBase * 100);
    $('#perd-out').textContent = `${$('#perd').value} %`;
  }
  actualizarEstado(est);
  manual.alEstado(est);
});
es.addEventListener('aire', (e) => {
  const t = JSON.parse(e.data);
  agregarAire(t);
  manual.alAire(t);
});
es.addEventListener('traza', (e) => {
  const t = JSON.parse(e.data);
  mostrarTraza(t);
  manual.alTraza(t);
});
es.addEventListener('mes', (e) => manual.alMES(JSON.parse(e.data)));
es.addEventListener('mqtt', (e) => agregarMQTT(JSON.parse(e.data)));
