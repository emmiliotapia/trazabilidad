// Terminal interactiva: la persona usa una inyectora como operador (lector de códigos + báscula),
// sigue misiones guiadas y ve el viaje de cada mensaje: terminal → aire LoRa → gateway → puente → MQTT → MES → ACK.
import { $, h, segmentar, dibujarSegmentos, LEYENDA_TRAMA } from './comun.js';

const AIRE = { ok: 'recibida', colision: 'chocó con otra trama', perdida: 'perdida por ruido', sin_senal: 'sin señal' };
const ESTADOS = {
  memoria: 'en memoria de la terminal',
  aire: 'viajando por radio',
  reintento: 'reintentando',
  sin_senal: 'sin señal · guardado en memoria',
  mqtt: 'publicado en MQTT',
  mes: 'guardado en el MES',
  confirmado: 'confirmado',
  atrasado: 'entregado con retraso',
};

let meta = null;
let maquina = 'INY-01';
let info = null; // etiquetas y fase de la máquina (API)
let vista = null; // última vista del nodo (SSE estado)
let foco = null; // seq del escaneo que se anima
const escaneos = new Map(); // seq → { codigo, cp, ok, estado, chip, offline, intentos }

const api = (cuerpo) => fetch('/api/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maquina, ...cuerpo }) }).then((r) => r.json());
const control = (cuerpo) => fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }).then((r) => r.json());
const visible = () => !$('#vista-terminal').hidden;
const pad2 = (n) => String(n).padStart(2, '0');

export function configurar(m) {
  meta = m;
}

function mensaje(texto, tipo = '') {
  const p = $('#m-mensaje');
  p.textContent = texto ?? '';
  p.dataset.tipo = tipo;
}

// ───────────────────────── misiones ─────────────────────────
const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const obs = JSON.parse(localStorage.getItem('misiones-obs') || '{}');
const guardarObs = () => localStorage.setItem('misiones-obs', JSON.stringify(obs));
function marcar(k, v = true) {
  if (obs[k] === v) return;
  obs[k] = v;
  guardarObs();
  pintarMisiones();
}

const MISIONES = [
  {
    id: 'arranque',
    titulo: 'Arranque la máquina',
    pasos: 'Escanee su gafete, la carpeta de la OT y el QR de la máquina, en ese orden.',
    aprende: 'La terminal valida los tres códigos sin preguntar al servidor: tiene guardada la OT y los operadores habilitados que el MES le mandó por LoRa en CP 05.',
    hecha: () => obs.cp6ok,
  },
  {
    id: 'bolsa',
    titulo: 'Registre una bolsa',
    pasos: 'Presione "Poner bolsa en la báscula" y escanee la etiqueta marcada como siguiente.',
    aprende: 'La terminal compara el peso contra la tolerancia de la OT y revisa que la etiqueta sea la que sigue. El resultado se ve al instante; el envío por radio ocurre después.',
    hecha: () => (obs.cp7ok ?? 0) >= 1,
  },
  {
    id: 'peso',
    titulo: 'Bolsa fuera de peso',
    pasos: 'Mueva la báscula fuera de la tolerancia, póngala y escanee la etiqueta siguiente.',
    aprende: 'La bolsa no avanza: la terminal muestra la falla y el MES registra una alerta ámbar. Al corregir el peso, la misma etiqueta se acepta.',
    hecha: () => obs.pesoFalla,
  },
  {
    id: 'secuencia',
    titulo: 'Etiqueta fuera de orden',
    pasos: 'Pese una bolsa y escanee la etiqueta que "se salta una".',
    aprende: 'Las etiquetas correlativas no pueden saltarse: así nunca falta ni sobra una bolsa en la OT.',
    hecha: () => obs.secuenciaFalla,
  },
  {
    id: 'senal',
    titulo: 'Trabaje sin señal',
    pasos: 'Presione "Cortar la señal LoRa", registre una bolsa y después presione "Restablecer la señal LoRa".',
    aprende: 'Sin señal la terminal sigue validando y guarda los eventos en su memoria. Al volver la señal los reenvía y el MES los marca como atrasados. La línea nunca se detiene por la radio.',
    hecha: () => obs.atrasado,
  },
  {
    id: 'supervisor',
    titulo: 'Error de arranque y supervisor',
    pasos: 'Al inicio de una OT nueva, escanee el gafete no habilitado (E9999), la OT y el QR. Después presione "Llamar al supervisor".',
    aprende: 'Un arranque inválido bloquea la terminal y enciende el Andon rojo. Solo el supervisor la libera, y esa orden también viaja por LoRa (comando DESBLOQUEAR).',
    hecha: () => obs.cp6falla && obs.desbloqueo,
  },
  {
    id: 'charola',
    titulo: 'Complete una charola',
    pasos: 'Registre 4 bolsas de la misma OT.',
    aprende: 'Con 4 bolsas se llena una charola: sale sola a inspección TEP (CP 08), liberación (CP 09) y traslado a SM1 (CP 10). Búsquela después en la pestaña Trazabilidad.',
    hecha: () => obs.charola,
  },
];

// Una misión a la vez: se muestra la pendiente; al cumplirse se celebra y pasa sola a la siguiente.
let verIdx = null; // misión que se está mostrando (null = la primera pendiente)
let celebrando = null; // índice de la misión recién cumplida
let hechasAntes = new Set(MISIONES.filter((m) => m.hecha()).map((m) => m.id));
let timerCelebrar;

const primeraPendiente = () => {
  const i = MISIONES.findIndex((m) => !m.hecha());
  return i < 0 ? MISIONES.length - 1 : i;
};

function irA(i, animar = true) {
  verIdx = Math.max(0, Math.min(MISIONES.length - 1, i));
  pintarMisiones(animar);
}

function pintarMisiones(animar = false) {
  const ahora = new Set(MISIONES.filter((m) => m.hecha()).map((m) => m.id));
  const nueva = MISIONES.findIndex((m) => ahora.has(m.id) && !hechasAntes.has(m.id));
  hechasAntes = ahora;
  if (nueva >= 0) {
    // celebrar la recién cumplida y después avanzar a la siguiente pendiente
    celebrando = nueva;
    verIdx = nueva;
    animar = true;
    clearTimeout(timerCelebrar);
    timerCelebrar = setTimeout(() => {
      celebrando = null;
      verIdx = null;
      pintarMisiones(true);
    }, 5000);
  }
  const idx = verIdx ?? primeraPendiente();
  const m = MISIONES[idx];
  const hecha = m.hecha();
  const total = ahora.size;

  $('#m-num').textContent = `${idx + 1} de ${MISIONES.length}`;
  $('#m-puntos').replaceChildren(...MISIONES.map((x, i) => {
    const b = h('button', {
      type: 'button',
      class: `${x.hecha() ? 'hecha' : ''}${i === idx ? ' viendo' : ''}`,
      title: x.titulo,
      'aria-label': `${i + 1}. ${x.titulo}${x.hecha() ? ' (completada)' : ''}`,
    });
    b.onclick = () => irA(i);
    return h('li', {}, b);
  }));
  $('#m-prev').disabled = idx === 0;
  $('#m-next').disabled = idx === MISIONES.length - 1;

  const tarjeta = h('div', { class: `mision${hecha ? ' hecha' : ''}${celebrando === idx ? ' celebra' : ''}` },
    h('div', { class: 'mision-cab' },
      h('span', { class: 'check', 'aria-hidden': 'true', text: hecha ? '✓' : String(idx + 1) }),
      h('b', { text: m.titulo }),
      hecha ? h('span', { class: 'sello', text: celebrando === idx ? '¡Lograda!' : 'Completada' }) : null),
    h('p', { class: 'pasos', text: m.pasos }));
  if (m.id === 'arranque' && !hecha) {
    tarjeta.append(h('div', { class: 'subpasos' }, ...['gafete', 'ot', 'qr'].map((k) =>
      h('span', { class: vista?.lecturas?.[k] || vista?.arrancada ? 'ok' : '', text: { gafete: 'Gafete', ot: 'OT', qr: 'QR' }[k] }))));
  }
  tarjeta.append(h('p', { class: 'aprende' }, h('b', { text: hecha ? 'Lo que aprendió: ' : 'Qué va a ver: ' }), m.aprende));

  const pie = h('div', { class: 'mision-pie' });
  if (celebrando === idx && total < MISIONES.length) pie.append(h('span', { class: 'siguiente', text: 'Pasando a la siguiente misión…' }));
  else if (total === MISIONES.length) pie.append(h('span', { class: 'siguiente', text: 'Completó las 7 misiones.' }));
  else if (idx !== primeraPendiente()) {
    const volver = h('button', { type: 'button', class: 'btn-texto', text: 'Ir a la misión pendiente' });
    volver.onclick = () => irA(primeraPendiente());
    pie.append(volver);
  }
  const reiniciar = h('button', { type: 'button', class: 'btn-texto', text: 'Reiniciar misiones' });
  reiniciar.onclick = () => {
    for (const k of Object.keys(obs)) delete obs[k];
    guardarObs();
    hechasAntes = new Set();
    celebrando = null;
    irA(0);
  };
  pie.append(reiniciar);
  tarjeta.append(pie);

  if (animar && !reducido) tarjeta.classList.add('entra');
  $('#m-mision').replaceChildren(tarjeta);
}
$('#m-prev').onclick = () => irA((verIdx ?? primeraPendiente()) - 1);
$('#m-next').onclick = () => irA((verIdx ?? primeraPendiente()) + 1);

// ───────────────────────── animación del viaje ─────────────────────────
const cola = [];
let animando = false;

function centro(i) {
  const est = document.querySelector(`#m-viaje .estacion-v[data-i="${i}"]`);
  return est.offsetLeft + est.offsetWidth / 2;
}

function reiniciarViaje(titulo) {
  cola.length = 0;
  for (const p of document.querySelectorAll('#m-viaje .estacion-v')) {
    p.dataset.estado = '';
    p.querySelector('p').textContent = '';
  }
  const paq = $('#m-paquete');
  paq.hidden = false;
  paq.className = 'paquete';
  paq.style.transition = 'none';
  paq.style.left = `${centro(0)}px`;
  $('#m-viaje-titulo').textContent = titulo;
  $('#m-explica').textContent = '';
}

function encolar(...pasos) {
  cola.push(...pasos);
  if (!animando) siguiente();
}

function siguiente() {
  const p = cola.shift();
  if (!p) {
    animando = false;
    return;
  }
  animando = true;
  const lento = $('#m-lento').checked && !reducido;
  const ms = reducido ? 0 : lento ? 1000 : 280;
  const paq = $('#m-paquete');
  paq.className = `paquete ${p.clase ?? ''}`;
  paq.style.transition = ms ? `left ${ms}ms ease-in-out` : 'none';
  paq.style.left = `${centro(p.a)}px`;
  setTimeout(() => {
    const est = document.querySelector(`#m-viaje .estacion-v[data-i="${p.a}"]`);
    if (p.nota !== undefined) est.querySelector('p').textContent = p.nota;
    if (p.estado) est.dataset.estado = p.estado;
    if (p.explica) $('#m-explica').textContent = p.explica;
    setTimeout(siguiente, lento ? 1100 : 120);
  }, ms);
}

// ───────────────────────── escanear ─────────────────────────
async function escanear(codigo) {
  if (!codigo) return;
  const r = await api({ accion: 'escanear', codigo });
  if (!r.ok) return mensaje(r.mensaje, 'mal');
  const ev = r.evento;
  const li = h('li', {}, h('time', { text: new Date().toLocaleTimeString('es-MX', { hour12: false }) }), h('code', { text: codigo }));
  if (!ev) {
    li.append(h('span', { class: 'res', text: r.mensaje }), h('span', { class: 'chip-estado nada', text: 'no se envía nada' }));
    foco = null;
    reiniciarViaje(`Escaneó ${codigo}: la terminal solo lo anotó.`);
    encolar({ a: 0, estado: 'espera', nota: r.mensaje, explica: 'Este código por sí solo no completa un checkpoint, así que no se envía nada por radio. La terminal lo guarda y espera el siguiente.' });
    mensaje(r.mensaje);
  } else {
    const chip = h('span', { class: 'chip-estado memoria', text: ESTADOS.memoria });
    li.append(h('span', { class: `res ${ev.ok ? 'bien' : 'mal'}`, text: `CP ${pad2(ev.cp)} · ${ev.ok ? 'correcto' : ev.texto}` }), chip);
    escaneos.set(ev.seq, { codigo, cp: ev.cp, ok: ev.ok, chip, offline: !!vista?.sinSenal, estado: 'memoria', intentos: 0 });
    foco = ev.seq;
    reiniciarViaje(`Escaneo ${codigo} · CP ${pad2(ev.cp)} · mensaje número ${ev.seq}`);
    $('#m-bytes').replaceChildren(h('span', { class: 'vacio', text: 'Esperando a que la trama salga por radio…' }));
    encolar({
      a: 0,
      estado: ev.ok ? 'ok' : 'mal',
      nota: `Gate local: ${ev.ok ? 'correcto' : ev.texto}`,
      explica: `La terminal validó al instante con lo que tiene en memoria y ${ev.ok ? 'dio el paso por bueno' : 'detuvo el paso'}. Ahora arma una trama de ${ev.bytes} bytes y la guarda hasta que el servidor confirme que la recibió.`,
    });
    if (ev.cp === 6 && ev.ok) marcar('cp6ok');
    if (ev.cp === 6 && !ev.ok) marcar('cp6falla');
    if (ev.cp === 7 && ev.ok) marcar('cp7ok', (obs.cp7ok ?? 0) + 1);
    if ((obs.cp7ok ?? 0) >= 4) marcar('charola');
    if (ev.codigo === 'PESO_FUERA_TOLERANCIA') marcar('pesoFalla');
    if (ev.codigo === 'SECUENCIA_ROTA') marcar('secuenciaFalla');
    mensaje(r.mensaje, ev.ok ? 'bien' : 'mal');
  }
  $('#m-historial').prepend(li);
  while ($('#m-historial').children.length > 40) $('#m-historial').lastChild.remove();
  cargarEtiquetas();
}

// Los avisos (aire, MQTT, MES, ACK) pueden llegar al navegador en otro orden;
// la animación siempre los muestra en el orden real del viaje.
const ORDEN = ['aire', 'traza', 'mes', 'ack'];
function ofrecer(e, etapa, pasos) {
  if (etapa === 'aire' && e.sig >= ORDEN.length) {
    e.etapas = {};
    e.sig = 0;
  }
  e.etapas ??= {};
  e.sig ??= 0;
  e.etapas[etapa] = pasos;
  while (e.sig < ORDEN.length && e.etapas[ORDEN[e.sig]]) encolar(...e.etapas[ORDEN[e.sig++]]);
}

function cambiarEstado(seq, estado, texto) {
  const e = escaneos.get(seq);
  if (!e) return;
  e.estado = estado;
  e.chip.textContent = texto ?? ESTADOS[estado];
  e.chip.className = `chip-estado ${estado}`;
}

// ───────────────────────── eventos del servidor (los reenvía app.js) ─────────────────────────
export function alAire(t) {
  if (t.nodo !== maquina) return;
  if (t.dir === 'subida' && t.tipo === 'EVENTO' && escaneos.has(t.seq)) {
    const e = escaneos.get(t.seq);
    e.intentos++;
    if (t.estado === 'ok') cambiarEstado(t.seq, 'aire');
    else if (t.estado === 'sin_senal') cambiarEstado(t.seq, 'sin_senal', `${ESTADOS.sin_senal} (intento ${e.intentos})`);
    else cambiarEstado(t.seq, 'reintento', `${AIRE[t.estado]} · reintentando`);
    if (t.seq !== foco) return;
    if (t.estado === 'ok') {
      $('#m-bytes').replaceChildren(...dibujarSegmentos(segmentar(t.hex, meta)));
      ofrecer(e, 'aire', [
        { a: 1, clase: 'datos', estado: 'ok', nota: `${t.bytes} B · ${t.airtimeMs} ms · ${t.rssi} dBm`, explica: `La trama cruza la planta por radio en ${t.airtimeMs} ms${e.intentos > 1 ? `, al intento ${e.intentos}` : ''}. Mientras viaja, ninguna otra terminal puede usar el canal.` },
        { a: 2, clase: 'datos', estado: 'ok', nota: 'trama recibida', explica: 'El gateway la recibe y se la pasa al puente por USB.' },
      ]);
    } else {
      const textos = {
        colision: 'Otra terminal transmitió al mismo tiempo y las dos tramas se arruinaron. Como nadie confirma, la terminal reintentará después de una espera al azar, para no volver a chocar.',
        perdida: 'El ruido eléctrico de la planta dañó la trama. La terminal no recibe confirmación y la reenvía.',
        sin_senal: 'La terminal está fuera de alcance. El evento se queda en su memoria y se reenviará cuando regrese la señal. La validación ya se hizo, así que la producción sigue.',
      };
      encolar(
        { a: 1, clase: 'datos choque', estado: 'mal', nota: AIRE[t.estado], explica: textos[t.estado] },
        { a: 0, clase: 'datos', estado: 'espera', nota: `en memoria · intento ${e.intentos}` },
      );
    }
  }
  if (t.dir === 'bajada' && t.tipo === 'ACK' && escaneos.has(t.seqAck)) {
    const e = escaneos.get(t.seqAck);
    if (t.estado === 'ok') cambiarEstado(t.seqAck, e.estado === 'atrasado' ? 'atrasado' : 'confirmado');
    if (t.seqAck !== foco) return;
    if (t.estado === 'ok') {
      ofrecer(e, 'ack', [
        { a: 3, clase: 'ack', explica: 'El puente responde con un ACK: un mensaje corto que dice "recibí tu mensaje número tal".' },
        { a: 2, clase: 'ack' },
        { a: 1, clase: 'ack', nota: `ACK de ${t.bytes} B` },
        { a: 0, clase: 'ack', estado: 'ok', nota: 'confirmado: se borra de memoria', explica: 'La terminal recibe el ACK, borra el evento de su memoria y ajusta su reloj con la hora del servidor. Fin del viaje.' },
      ]);
    } else {
      ofrecer(e, 'ack', [
        { a: 3, clase: 'ack' },
        { a: 2, clase: 'ack' },
        { a: 1, clase: 'ack choque', nota: 'ACK perdido', explica: 'El ACK se perdió en el camino. La terminal cree que su mensaje no llegó y lo reenviará; el MES reconocerá la copia por su número y la descartará.' },
      ]);
    }
  }
}

export function alTraza(t) {
  const seq = t.json?.seq;
  if (t.json?.nodo !== maquina || !escaneos.has(seq) || !t.topico.endsWith('/evento')) return;
  const e = escaneos.get(seq);
  if (!['mes', 'confirmado', 'atrasado'].includes(e.estado)) cambiarEstado(seq, 'mqtt');
  if (seq !== foco) return;
  const corto = t.topico.split('/').slice(-3).join('/');
  ofrecer(e, 'traza', [
    { a: 3, clase: 'datos', estado: 'ok', nota: 'firma correcta · JSON', explica: 'El puente revisa la firma (descarta tramas falsas o alteradas) y convierte los bytes en un JSON que cualquier sistema entiende.' },
    { a: 4, clase: 'datos', estado: 'ok', nota: corto, explica: `Publica el JSON en el broker MQTT, en el tópico ${t.topico}. Cualquier sistema suscrito lo recibe: el MES, un tablero o el ERP.` },
  ]);
}

export function alMES(m) {
  if (m.nodo !== maquina || !escaneos.has(m.seq)) return;
  const e = escaneos.get(m.seq);
  if (m.duplicado) {
    if (m.seq === foco) encolar({ a: 5, nota: 'copia repetida descartada', explica: 'Llegó una copia del mismo mensaje (por un reintento). El MES la reconoce por su número y la descarta: nada se cuenta dos veces.' });
    return;
  }
  if (m.diferido || e.offline) {
    cambiarEstado(m.seq, 'atrasado');
    marcar('atrasado');
  } else if (e.estado !== 'confirmado') cambiarEstado(m.seq, 'mes');
  if (m.seq !== foco) return;
  ofrecer(e, 'mes', [{
    a: 5,
    clase: 'datos',
    estado: m.resultado === 'PASS' ? 'ok' : 'mal',
    nota: m.resultado === 'PASS' ? 'guardado en la genealogía' : `guardado + alerta ${m.codigo}`,
    explica: m.resultado === 'PASS'
      ? `El MES guarda el evento y actualiza la genealogía (OT → bolsa → caja → tarima).${m.diferido || e.offline ? ' Llegó con retraso y queda marcado así.' : ''}`
      : 'El MES guarda el evento y levanta una alerta para supervisión. Queda registro de quién, qué y cuándo.',
  }]);
}

export function alEstado(est) {
  if (!$('#m-maquina').options.length) {
    for (const x of est.nodos.filter((y) => y.tipo === 'inyectora')) $('#m-maquina').append(h('option', { value: x.nombre, text: x.nombre }));
  }
  const n = est.nodos.find((x) => x.nombre === maquina);
  if (!n) return;
  if (vista?.bloqueado && !n.bloqueado) marcar('desbloqueo');
  const cambioLecturas = JSON.stringify(vista?.lecturas) !== JSON.stringify(n.lecturas) || vista?.arrancada !== n.arrancada;
  vista = n;
  $('#m-nombre').textContent = n.nombre;
  $('#m-senal').textContent = n.sinSenal ? 'sin señal' : `${n.rssi} dBm`;
  $('#m-senal').classList.toggle('mala', n.sinSenal);
  $('#m-l1').textContent = n.pantalla.l1;
  $('#m-l2').textContent = n.pantalla.l2;
  document.querySelector('.equipo').dataset.color = n.pantalla.color;
  for (const s of document.querySelectorAll('#m-arranque span')) s.classList.toggle('ok', !!(n.arrancada || n.lecturas?.[s.dataset.k]));
  const total = n.bufer;
  $('#m-bufer').replaceChildren(
    ...Array.from({ length: Math.min(total, 10) }, () => h('i', { class: n.sinSenal ? 'sin' : '' })),
    h('small', { text: total ? `${total} ${total === 1 ? 'evento espera' : 'eventos esperan'} confirmación` : 'vacía: todo confirmado' }),
  );
  const btn = $('#m-senal-btn');
  btn.textContent = n.sinSenal ? 'Restablecer la señal LoRa' : 'Cortar la señal LoRa';
  btn.classList.toggle('alerta', n.sinSenal);
  if (cambioLecturas) pintarMisiones();
}

// ───────────────────────── etiquetas y controles ─────────────────────────
async function cargarEtiquetas() {
  const r = await fetch(`/api/manual/etiquetas?maquina=${maquina}`);
  if (!r.ok) return;
  info = await r.json();
  $('#m-tomar').textContent = info.manual ? 'Regresar a automático' : 'Tomar el control';
  $('#m-tomar').classList.toggle('secundario', info.manual);
  $('#m-ot').disabled = !info.puedePedirOT;
  $('#m-ot').title = info.puedePedirOT ? '' : info.ayuda;
  $('#m-sup').disabled = !info.manual || !info.bloqueado;
  $('#m-ayuda').textContent = info.ayuda;
  $('#m-fase').textContent = `${info.manual ? 'Manual' : 'Automático'} · ${info.ot ?? 'sin OT'} · ${info.fase}${info.producto ? ` · ${info.producto.descripcion}` : ''}`;
  $('#m-scan').disabled = !info.manual;
  const sinBascula = !info.manual || !info.bascula;
  $('#m-peso').disabled = sinBascula;
  $('#m-form-peso button').disabled = sinBascula;
  if (info.bascula && document.activeElement !== $('#m-peso')) {
    const peso = $('#m-peso');
    peso.min = Math.round(info.bascula.nominal * 0.9);
    peso.max = Math.round(info.bascula.nominal * 1.1);
    if (peso.dataset.ot !== info.ot) {
      peso.value = info.bascula.nominal;
      peso.dataset.ot = info.ot;
    }
    pintarPeso();
  } else if (!info.bascula) $('#m-peso-out').textContent = 'sin OT';
  $('#m-etiquetas').replaceChildren(
    ...info.grupos.map((g) =>
      h('div', { class: 'grupo' }, h('h3', { text: g.titulo }),
        h('div', { class: 'chips' }, ...g.items.map((it) => {
          const b = h('button', { type: 'button', class: `chip${it.malo ? ' malo' : ''}`, disabled: !info.manual }, h('code', { text: it.codigo }), h('small', { text: it.nota }));
          b.onclick = () => escanear(it.codigo);
          return b;
        })))),
  );
}

function pintarPeso() {
  if (!info?.bascula) return;
  const { nominal, tol } = info.bascula;
  const v = Number($('#m-peso').value);
  const fuera = Math.abs(v - nominal) > tol;
  $('#m-peso-out').textContent = `${v} g · ${fuera ? 'fuera de tolerancia' : 'dentro de tolerancia'} (${nominal} ± ${tol})`;
  $('#m-peso-out').classList.toggle('fuera', fuera);
}

$('#m-maquina').onchange = (e) => {
  maquina = e.target.value;
  foco = null;
  vista = null;
  escaneos.clear();
  $('#m-historial').replaceChildren();
  reiniciarViaje('Escanee algo para ver por dónde pasa el mensaje.');
  $('#m-paquete').hidden = true;
  mensaje('');
  cargarEtiquetas();
};
$('#m-tomar').onclick = async () => {
  const r = await api({ accion: info?.manual ? 'soltar' : 'tomar' });
  mensaje(r.mensaje, r.ok ? '' : 'mal');
  await cargarEtiquetas();
  if (info?.manual) $('#m-scan').focus();
};
$('#m-ot').onclick = async () => {
  const r = await api({ accion: 'pedirOT' });
  mensaje(r.mensaje, r.ok ? '' : 'mal');
  cargarEtiquetas();
};
$('#m-sup').onclick = async () => {
  const r = await api({ accion: 'desbloquear' });
  mensaje(r.mensaje, r.ok ? '' : 'mal');
  setTimeout(cargarEtiquetas, 1500);
};
$('#m-senal-btn').onclick = async () => {
  if (vista?.sinSenal) {
    await control({ accion: 'conSenal', nodo: maquina });
    mensaje('Señal restablecida: la terminal reenviará lo que tenga en memoria en su siguiente intento.');
  } else {
    await control({ accion: 'sinSenal', nodo: maquina, segundos: 3600 });
    mensaje('Señal cortada: la terminal sigue validando, pero lo que envíe se quedará en su memoria.', 'mal');
  }
};
$('#m-form-scan').onsubmit = (e) => {
  e.preventDefault();
  const c = $('#m-scan').value.trim();
  $('#m-scan').value = '';
  escanear(c);
};
$('#m-peso').oninput = pintarPeso;
$('#m-form-peso').onsubmit = async (e) => {
  e.preventDefault();
  const r = await api({ accion: 'pesar', gramos: $('#m-peso').value });
  mensaje(r.mensaje, r.ok ? '' : 'mal');
  $('#m-scan').focus();
};
$('#m-leyenda').replaceChildren(...LEYENDA_TRAMA.map(([c, t]) => h('li', {}, h('i', { style: `background:${c}` }), t)));
setInterval(() => visible() && cargarEtiquetas(), 2500);
document.querySelector('[data-vista="terminal"]').addEventListener('click', () => {
  cargarEtiquetas();
  pintarMisiones();
  if (info?.manual) setTimeout(() => $('#m-scan').focus(), 50);
});
pintarMisiones();
