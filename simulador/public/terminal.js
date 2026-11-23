// Terminal interactiva: la persona usa una inyectora como operador (lector de códigos + báscula),
// sigue misiones guiadas y ve el viaje de cada mensaje: terminal → aire LoRa → gateway → puente → MQTT → MES → ACK.
import { $, h, segmentar, dibujarSegmentos, LEYENDA_TRAMA, opcionesPorLinea } from './comun.js';

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
let maquina = 'L1-INY-01';
let info = null; // etiquetas y fase de la máquina (API)
let vista = null; // última vista del nodo (SSE estado)
let foco = null; // seq del escaneo que se anima
let ultimoEstado = null; // último estado completo de la planta (SSE), para elegir una máquina libre
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
  if (!codigo) return null;
  destello($('#m-form-scan'), 'lee', 450);
  const r = await api({ accion: 'escanear', codigo });
  if (!r.ok) {
    mensaje(r.mensaje, 'mal');
    return r;
  }
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
  return r;
}

function destello(el, clase, ms) {
  if (!el) return;
  el.classList.add(clase);
  clearTimeout(el._destello);
  el._destello = setTimeout(() => el.classList.remove(clase), ms);
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
  // LED de la placa: rojo cuando la terminal transmite, verde cuando le llega algo del gateway
  if (t.dir === 'subida') destello($('#m-led'), 'tx', 220);
  else if (t.estado === 'ok') destello($('#m-led'), 'rx', 220);
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
  ultimoEstado = est;
  if (!$('#m-maquina').options.length) {
    opcionesPorLinea($('#m-maquina'), est.nodos);
    $('#m-maquina').value = maquina;
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
  $('#m-l3').textContent = `${n.sinSenal ? 'SIN SEÑAL' : `LoRa ${n.rssi} dBm`} · memoria ${n.bufer}`;
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
  const nuevo = await r.json();
  if (nuevo.maquina !== maquina) return; // llegó tarde, de otra máquina
  info = nuevo;
  pintarQR(info.qr);
  pintarRecorrido();
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
  info = null;
  reiniciarRecorrido();
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
  pintarRecorrido();
  if (info?.manual) setTimeout(() => $('#m-scan').focus(), 50);
});
pintarMisiones();

// ───────────────────────── QR fijo de la máquina (dibujo) ─────────────────────────
// Es un dibujo con forma de QR generado a partir del código (no un QR legible por teléfono):
// tres marcas de esquina y módulos que dependen del texto, para que cada máquina tenga el suyo.
let qrPintado = null;
function pintarQR(texto) {
  if (!texto || texto === qrPintado) return;
  qrPintado = texto;
  $('#m-qr-txt').textContent = texto;
  const n = 25;
  let s = 2166136261;
  for (const c of texto) s = Math.imul(s ^ c.charCodeAt(0), 16777619);
  const azarQR = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const marca = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!marca(x, y) && azarQR() < 0.48) d += `M${x} ${y}h1v1h-1z`;
  const esquina = (x, y) => `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`;
  d += esquina(0, 0) + esquina(n - 7, 0) + esquina(0, n - 7);
  $('#m-qr').innerHTML = `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" role="img" aria-label="QR de la máquina"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${d}" fill="#111" fill-rule="evenodd"/></svg>`;
}

// ───────────────────────── recorrido guiado de una OT ─────────────────────────
// Un botón "Siguiente" lleva una OT de principio a fin. Cada paso hace lo que haría la persona
// en planta (pedir la OT, escanear, pesar) con las mismas llamadas que el modo libre, y el paso
// actual se deduce del estado real de la máquina: si alguien escanea a mano, el recorrido lo sigue.
const PASOS = [
  { id: 'tomar', corto: 'Tomar la máquina' },
  { id: 'pedir', corto: 'Solicitar la OT' },
  { id: 'gafete', corto: 'Gafete' },
  { id: 'ot', corto: 'Carpeta de la OT' },
  { id: 'qr', corto: 'QR de la máquina' },
  { id: 'bolsa', corto: 'Bolsa 1: pesar y etiquetar' },
  { id: 'charola', corto: 'Bolsas 2–4: charola 1' },
  { id: 'resto', corto: 'Bolsas 5–12' },
  { id: 'planta', corto: 'Recorre la planta' },
];
const R = { ot: null, g: null, ocupado: false, progreso: '', revelado: 0, tRevelado: 0, fichaVista: null, viendoPrep: false, error: null, clavesErr: '' };
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
const modoGuiado = () => $('#vista-terminal').dataset.modo === 'guiado';

function reiniciarRecorrido() {
  R.ot = null;
  R.g = null;
  R.progreso = '';
  R.revelado = 0;
  R.fichaVista = null;
  R.viendoPrep = false;
  R.error = null;
}

function pasoActual() {
  if (!info?.manual) return 'tomar';
  const f = info.faseClave;
  if (R.viendoPrep) return 'pedir'; // se queda aquí hasta que el presentador pulse Continuar
  if (info.solicitada || ['planificacion', 'resina', 'liberacion'].includes(f)) return 'pedir';
  if (f === 'produccion') {
    if (!info.arrancada) {
      const l = vista?.lecturas ?? {};
      if (!l.gafete) return 'gafete';
      if (!l.ot) return 'ot';
      return 'qr';
    }
    const k = info.siguiente ?? 1;
    if (k <= 1) return 'bolsa';
    if (k <= (info.bolsasPorCharola ?? 4)) return 'charola';
    return 'resto';
  }
  if (f === 'cierre' || (f === 'terminada' && R.ot)) return 'planta';
  return 'pedir';
}

// Lo que el MES ya registró de esta OT, por checkpoint
function cpsDeLaOT() {
  const m = new Map();
  for (const e of R.g?.eventos ?? []) {
    const antes = m.get(e.cp);
    m.set(e.cp, { ok: (antes?.ok ?? 0) + (e.resultado === 'PASS' ? 1 : 0), mal: (antes?.mal ?? 0) + (e.resultado === 'PASS' ? 0 : 1) });
  }
  return m;
}

async function cargarGenealogiaRecorrido() {
  if (!R.ot || !visible() || !modoGuiado()) return;
  const ot = R.ot;
  const r = await fetch(`/api/genealogia?id=${encodeURIComponent(ot)}`);
  if (R.ot !== ot || !r.ok) return;
  R.g = await r.json();
  pintarRecorrido();
}

const grupo = (titulo) => info?.grupos?.find((g) => g.titulo === titulo)?.items ?? [];
const codigoGafete = () => grupo('Gafetes').find((x) => !x.malo)?.codigo;
const codigoQR = () => grupo('QR fijo de la máquina').find((x) => !x.malo)?.codigo;
const etiquetaSiguiente = () => grupo('Etiquetas correlativas del sobre').find((x) => x.nota.startsWith('siguiente'))?.codigo;

// Una bolsa completa: báscula (peso dentro de tolerancia) y etiqueta correlativa (CP 07)
async function registrarBolsa() {
  const b = info?.bascula;
  if (!b) return false;
  const gramos = Math.round(b.nominal + (Math.random() - 0.5) * (b.tol / 2));
  $('#m-peso').value = gramos;
  pintarPeso();
  await api({ accion: 'pesar', gramos });
  await pausa(350);
  const codigo = etiquetaSiguiente();
  if (!codigo) return false;
  const r = await escanear(codigo);
  await cargarEtiquetas();
  return !!r?.evento?.ok;
}

async function bolsasHasta(hasta) {
  while (info?.manual && info.faseClave === 'produccion' && (info.siguiente ?? 99) <= hasta) {
    R.progreso = `Registrando la bolsa ${info.siguiente} de ${info.totalBolsas}…`;
    pintarRecorrido();
    if (!(await registrarBolsa())) break;
    await pausa(1100);
  }
  R.progreso = '';
}

async function accionSiguiente() {
  if (R.ocupado) return;
  R.ocupado = true;
  const bloqueadaAntes = !!info?.bloqueado;
  if (!bloqueadaAntes) R.error = null;
  pintarRecorrido();
  try {
    if (bloqueadaAntes) {
      const r = await api({ accion: 'desbloquear' });
      mensaje(r.mensaje, r.ok ? '' : 'mal');
      await pausa(1500);
      R.error = r.ok
        ? { tipo: 'bien', titulo: 'El supervisor liberó la terminal', texto: 'La orden DESBLOQUEAR llegó por LoRa. La terminal borró las lecturas anteriores: el operador vuelve a escanear gafete, OT y QR, esta vez los correctos.' }
        : null;
      return;
    }
    const paso = pasoActual();
    if (paso === 'tomar') {
      const r = await api({ accion: 'tomar' });
      mensaje(r.mensaje, r.ok ? '' : 'mal');
    } else if (paso === 'pedir' && R.viendoPrep) {
      R.viendoPrep = false; // ya se vio cómo se generó: a arrancar la máquina
    } else if (paso === 'pedir') {
      reiniciarRecorrido();
      const r = await api({ accion: 'pedirOT' });
      mensaje(r.mensaje, r.ok ? '' : 'mal');
      R.viendoPrep = !!r.ok;
    } else if (paso === 'gafete') {
      await escanear(codigoGafete());
    } else if (paso === 'ot') {
      await escanear(info.ot);
    } else if (paso === 'qr') {
      destello(document.querySelector('.qr-maquina'), 'leido', 900);
      await escanear(codigoQR());
    } else if (paso === 'bolsa') {
      await registrarBolsa();
    } else if (paso === 'charola') {
      await bolsasHasta(info.bolsasPorCharola ?? 4);
    } else if (paso === 'resto') {
      await bolsasHasta(info.totalBolsas ?? 12);
    } else if (paso === 'planta') {
      verGenealogia(R.ot);
    }
  } finally {
    R.ocupado = false;
    await cargarEtiquetas();
  }
}

function verGenealogia(ot) {
  if (!ot) return;
  document.querySelector('[data-vista="traza"]').click();
  $('#q').value = ot;
  $('#form-busca').requestSubmit();
}

const cp = (num, texto, estado) => h('div', { class: `rcp ${estado ?? ''}` }, h('b', { text: num }), h('span', { text: texto }));

// Revela los checkpoints de la preparación uno por uno, aunque el servidor los complete casi juntos
function revelar(estados) {
  const ahora = Date.now();
  if (R.revelado < estados.length && estados[R.revelado] === 'ok' && ahora - R.tRevelado > 700) {
    R.revelado++;
    R.tRevelado = ahora;
  }
  return estados.map((e, i) => (i < R.revelado ? e : i === R.revelado ? 'va' : ''));
}

function fichaOT() {
  const o = R.g?.orden;
  if (!o) return null;
  const lote = R.g.lotes?.[0]?.id_lote;
  const dato = (k, v) => (v ? h('div', {}, h('dt', { text: k }), h('dd', { text: v })) : null);
  const ficha = h('dl', { class: `ot-ficha${R.fichaVista === o.ot ? '' : ' nueva'}` },
    dato('Orden de trabajo', o.ot),
    dato('Máquina', o.id_maquina),
    dato('Molde', o.id_molde),
    dato('Producto', info?.producto?.descripcion ? `${o.sku_producto} · ${info.producto.descripcion}` : o.sku_producto),
    dato('Resina', o.sku_resina),
    dato('Lote de resina', lote),
    dato('Bolsas', String(o.total_bolsas)),
    dato('Peso por bolsa', `${o.peso_nominal_g} ± ${o.tolerancia_g} g`),
    dato('Estado en el MES', o.estado));
  R.fichaVista = o.ot;
  return ficha;
}

function barraBolsas() {
  const total = info?.totalBolsas ?? 12;
  const por = info?.bolsasPorCharola ?? 4;
  const k = pasoActual() === 'planta' ? total + 1 : info?.siguiente ?? 1;
  const retiradas = cpsDeLaOT().get(10)?.ok ?? 0;
  const charolas = [];
  for (let c = 0; c < Math.ceil(total / por); c++) {
    const bolsas = Array.from({ length: por }, (_, i) => {
      const n = c * por + i + 1;
      return h('i', { class: n < k ? 'lista' : n === k && R.ocupado ? 'va' : '', title: `Bolsa ${n}` });
    });
    charolas.push(h('div', { class: `charola${c < retiradas ? ' salio' : ''}`, title: `Charola ${c + 1}${c < retiradas ? ': ya salió a SM1' : ''}` }, ...bolsas));
  }
  return h('div', { class: 'bolsas-barra' }, ...charolas, h('small', { text: `${Math.min(k - 1, total)} de ${total} bolsas · ${retiradas} charola(s) en camino a SM1` }));
}

function contenidoPaso(paso) {
  const n = info?.maquina ?? maquina;
  const tarjeta = (quien, titulo, texto, ...extra) => [h('span', { class: 'quien', text: quien }), h('h3', { text: titulo }), h('p', { text: texto }), ...extra];
  if (info?.bloqueado) {
    return { boton: 'Llamar al supervisor', partes: tarjeta('Terminal bloqueada · torreta en rojo', 'La máquina no arranca hasta que venga el supervisor',
      'La terminal no deja producir con un arranque inválido y no acepta más escaneos. El rechazo ya viajó por LoRa al MES, así que en la pantalla de planta esta máquina aparece en rojo. Solo el supervisor la libera desde el MES; esa orden también llega por radio.') };
  }
  switch (paso) {
    case 'tomar': {
      const ocupada = vista && vista.pantalla?.color !== 'gris';
      return {
        boton: `Tomar el control de ${n}`,
        partes: tarjeta('Usted, frente a la máquina', `Tome el control de ${n}`,
          'La máquina deja de trabajar sola y usted hace de operador. Las otras inyectoras siguen en automático.',
          ocupada ? h('p', { class: 'esperando', text: 'Esta máquina ya trae una OT a medias. Para ver el recorrido completo desde cero, use "Elegir una máquina libre".' }) : null),
      };
    }
    case 'pedir': {
      const enCamino = R.viendoPrep || info?.solicitada || ['planificacion', 'resina', 'liberacion'].includes(info?.faseClave);
      if (!enCamino) {
        return {
          boton: 'Solicitar una OT nueva',
          partes: tarjeta('Planeación', 'Solicite una OT nueva',
            'Al pedirla, el MES la programa (CP 03), el almacén sube la resina (CP 01–02), la mezanina la vacía en el embudo (CP 04) y el supervisor libera el sobre con las etiquetas 1..n (CP 05). Al final el MES manda la OT por LoRa a esta terminal.'),
        };
      }
      const ev = cpsDeLaOT();
      const real = [
        R.g?.lotes?.length || ev.has(4) ? 'ok' : '',
        ev.has(3) ? 'ok' : '',
        ev.has(4) ? (ev.get(4).ok ? 'ok' : 'mal') : '',
        ev.has(5) ? 'ok' : '',
        info?.faseClave === 'produccion' ? 'ok' : '',
      ];
      const vis = revelar(real);
      const lista = R.revelado >= real.length;
      return {
        boton: lista ? 'Continuar: arrancar la máquina' : 'Esperando a que llegue la OT…',
        espera: !lista,
        partes: [
          ...tarjeta('Planeación · almacén · mezanina · supervisor', R.g?.orden ? `Se generó la ${R.g.orden.ot}` : 'Generando la OT…',
            'Cada área registra su paso en el MES. Cuando el sobre se libera, el MES manda la OT a la terminal por radio y la pantalla pide gafete, OT y QR.'),
          h('div', { class: 'cps' },
            cp('CP 01–02', 'Lote de resina listo', vis[0]),
            cp('CP 03', 'OT programada', vis[1]),
            cp('CP 04', 'Resina en el embudo', vis[2]),
            cp('CP 05', 'Sobre liberado', vis[3]),
            cp('LoRa', 'OT llega a la terminal', vis[4])),
          fichaOT(),
        ],
      };
    }
    case 'gafete':
    case 'ot':
    case 'qr': {
      const l = vista?.lecturas ?? {};
      const chips = h('div', { class: 'cps' },
        cp('1', `Gafete ${codigoGafete() ?? ''}`, l.gafete ? 'ok' : paso === 'gafete' ? 'va' : ''),
        cp('2', `OT ${info?.ot ?? ''}`, l.ot ? 'ok' : paso === 'ot' ? 'va' : ''),
        cp('3', `QR ${codigoQR() ?? ''}`, paso === 'qr' ? 'va' : ''));
      const textos = {
        gafete: ['Escanee su gafete', `Escanear gafete ${codigoGafete() ?? ''}`, 'Primero el gafete: la terminal revisa que el operador esté habilitado para esta OT, con la lista que le mandó el MES. Todavía no sale nada por radio.'],
        ot: ['Escanee la carpeta de la OT', `Escanear ${info?.ot ?? 'la OT'}`, 'La terminal confirma que la carpeta es de la OT que tiene cargada. Si fuera de otra máquina, la detendría aquí.'],
        qr: ['Escanee el QR fijo de la máquina', `Escanear QR ${codigoQR() ?? ''}`, 'Con los 3 códigos en orden se completa CP 06: la máquina arranca, la torreta pasa a verde y sale el primer mensaje por LoRa. Abajo puede ver su viaje hasta el MES.'],
      }[paso];
      return { boton: textos[1], partes: [...tarjeta('Operador de inyección · CP 06', textos[0], textos[2]), chips, fichaOT()] };
    }
    case 'bolsa':
      return {
        boton: 'Pesar y etiquetar la bolsa 1',
        partes: [...tarjeta('Operador de inyección · CP 07', 'Cada bolsa: báscula y etiqueta',
          `La máquina ya está produciendo piezas que caen en una bolsa. Cuando la bolsa está llena, el operador la pone en la báscula: la terminal lee el peso y lo compara con ${info?.bascula?.nominal ?? '?'} ± ${info?.bascula?.tol ?? '?'} g (si pesa de más o de menos, sobran o faltan piezas). Después le pega la etiqueta que sigue del sobre (B1, B2, B3… hasta B${info?.totalBolsas ?? 'n'}) y la escanea. La terminal exige el orden: no se puede saltar ninguna.`), barraBolsas()],
      };
    case 'charola': {
      const por = info?.bolsasPorCharola ?? 4;
      return {
        boton: R.progreso || `Llenar la charola (bolsas ${info?.siguiente}–${por})`,
        partes: [...tarjeta('Operador de inyección · CP 07', 'Se repite con cada bolsa hasta llenar la charola',
          `La charola es la bandeja donde se acomodan las bolsas junto a la máquina: le caben ${por}. Este botón registra las bolsas ${info?.siguiente}–${por}, una por una (báscula y etiqueta). En cuanto la charola tiene ${por}, inspección la recoge: revisa una bolsa de muestra (CP 08), el supervisor la libera (CP 09) y se lleva a la mesa de empaque SM1 (CP 10). Mientras, la máquina sigue llenando la siguiente.`), barraBolsas()],
      };
    }
    case 'resto':
      return {
        boton: R.progreso || `Terminar la OT (bolsas ${info?.siguiente}–${info?.totalBolsas})`,
        partes: [...tarjeta('Operador de inyección · CP 07', 'Termine la OT',
          `Faltan ${(info?.totalBolsas ?? 0) - (info?.siguiente ?? 1) + 1} bolsas, o sea ${Math.ceil(((info?.totalBolsas ?? 0) - (info?.siguiente ?? 1) + 1) / (info?.bolsasPorCharola ?? 4))} charola(s) más. Es lo mismo de antes, bolsa por bolsa; este botón las registra seguidas. Cada charola que se completa sale a inspección y a SM1 mientras la máquina sigue. Con la última bolsa la OT queda completa en la máquina.`), barraBolsas()],
      };
    case 'planta': {
      const ev = cpsDeLaOT();
      const etapas = [[8, 'Inspección visual'], [9, 'Charola liberada'], [10, 'Retiro a SM1'], [11, 'Bolsas en caja'], [12, 'Caja cerrada'], [13, 'Pre-envío'], [14, 'Tarima'], [15, 'Cámara 4/4'], [16, 'Despachada']];
      const primeraFalta = etapas.findIndex(([c]) => !ev.get(c)?.ok);
      const despachada = !!ev.get(16)?.ok;
      return {
        boton: 'Ver la genealogía completa',
        partes: [
          ...tarjeta('Inspección · SM1 · almacén PT · embarque', despachada ? `¡La ${R.ot} ya se despachó!` : `La ${R.ot ?? 'OT'} recorre la planta`,
            despachada
              ? 'Pasó los 16 checkpoints. En la genealogía se ve todo su camino: lote de resina, bolsas, cajas, tarima y despacho.'
              : 'Ya no depende de la máquina: las charolas pasan a inspección y a SM1, las cajas a pre-envío y, cuando están todas, se arma la tarima, la cámara la confirma y se despacha. Se actualiza solo.'),
          h('div', { class: 'cps' }, ...etapas.map(([c, t], i) => cp(`CP ${String(c).padStart(2, '0')}`, `${t}${ev.get(c)?.ok > 1 ? ` ×${ev.get(c).ok}` : ''}`,
            ev.get(c)?.mal && !ev.get(c)?.ok ? 'mal' : ev.get(c)?.ok ? 'ok' : i === primeraFalta ? 'va' : ''))),
          barraBolsas(),
        ],
      };
    }
    default:
      return { boton: 'Siguiente ▶', partes: [] };
  }
}

function pintarRecorrido() {
  if (!modoGuiado()) return;
  if (info?.ot && info.faseClave && info.faseClave !== 'terminada' && R.ot !== info.ot) {
    R.ot = info.ot;
    R.g = null;
    cargarGenealogiaRecorrido();
  }
  const paso = pasoActual();
  const idx = PASOS.findIndex((p) => p.id === paso);
  $('#r-pasos').replaceChildren(...PASOS.map((p, i) =>
    h('li', { class: i < idx ? 'hecho' : i === idx ? 'actual' : '' }, h('b', { text: i < idx ? '✓' : String(i + 1) }), h('span', { text: p.corto }))));
  $('#r-ot').textContent = R.ot ?? '';
  const c = contenidoPaso(paso);
  $('#r-actual').replaceChildren(...[tarjetaError(), ...c.partes].filter(Boolean));
  pintarErrores(paso);
  const btn = $('#r-siguiente');
  btn.textContent = R.ocupado && !R.progreso ? 'Un momento…' : `${c.boton}${c.espera || R.progreso ? '' : ' ▶'}`;
  btn.disabled = R.ocupado || !!c.espera;
  $('#r-reiniciar').hidden = paso !== 'planta';
}

function ponerModo(m) {
  $('#vista-terminal').dataset.modo = m;
  localStorage.setItem('terminal-modo', m);
  for (const b of document.querySelectorAll('.t-modos button')) b.setAttribute('aria-selected', String(b.dataset.modo === m));
  if (m === 'guiado') pintarRecorrido();
  else pintarMisiones();
}

function elegirMaquinaLibre() {
  const libres = (ultimoEstado?.nodos ?? []).filter((n) => n.tipo === 'inyectora' && n.pantalla?.color === 'gris' && !n.sinSenal);
  if (!libres.length) return mensaje('No hay máquinas sin OT en este momento; elija cualquiera de la lista.', 'mal');
  const n = libres[Math.floor(Math.random() * libres.length)];
  const sel = $('#m-maquina');
  sel.value = n.nombre;
  sel.dispatchEvent(new Event('change'));
  mensaje(`${n.nombre} está libre (sin OT). Presione Siguiente para tomar el control.`);
}

for (const b of document.querySelectorAll('.t-modos button')) b.onclick = () => ponerModo(b.dataset.modo);
$('#r-siguiente').onclick = accionSiguiente;
$('#r-reiniciar').onclick = () => {
  reiniciarRecorrido();
  pintarRecorrido();
};
$('#m-libre-maq').onclick = elegirMaquinaLibre;
ponerModo(localStorage.getItem('terminal-modo') ?? 'guiado');
// Mientras se prepara la OT conviene preguntar más seguido; la genealogía alimenta los checkpoints
setInterval(() => {
  if (!visible() || !modoGuiado()) return;
  if (pasoActual() === 'pedir' && !R.ocupado) cargarEtiquetas();
  else pintarRecorrido();
}, 900);
setInterval(cargarGenealogiaRecorrido, 2500);

// ───────────────────────── errores para demostrar ─────────────────────────
// Cada botón hace mal un paso a propósito, con las mismas llamadas que haría el operador,
// para que se vea dónde se detiene la terminal y cómo se corrige.
function tarjetaError() {
  const e = R.error;
  if (!e) return null;
  return h('div', { class: `rec-error ${e.tipo ?? ''}` },
    h('strong', { text: e.titulo }),
    e.terminal ? h('p', {}, h('span', { class: 'quien', text: 'La terminal mostró: ' }), h('code', { text: e.terminal })) : null,
    h('p', { text: e.texto }),
    e.arreglo ? h('p', { class: 'arreglo' }, h('b', { text: 'Cómo se corrige: ' }), e.arreglo) : null);
}

async function arranqueConError(malo) {
  const bad = (titulo) => grupo(titulo).find((x) => x.malo)?.codigo;
  const codigos = {
    gafete: malo === 'gafete' ? bad('Gafetes') : codigoGafete(),
    ot: malo === 'ot' ? bad('Carpeta de la OT') : info.ot,
    qr: malo === 'qr' ? bad('QR fijo de la máquina') : codigoQR(),
  };
  // el arranque se valida completo al leer el QR, así que se escanean los tres
  await escanear(codigos.gafete);
  await pausa(800);
  await escanear(codigos.ot);
  await pausa(800);
  destello(document.querySelector('.qr-maquina'), 'leido', 900);
  const r = await escanear(codigos.qr);
  const que = {
    gafete: ['Gafete no habilitado', `Se escaneó el gafete ${codigos.gafete}, que no está en la lista de operadores autorizados para esta OT.`],
    ot: ['Carpeta de otra máquina', `Se escaneó la carpeta ${codigos.ot}, que pertenece a otra máquina: esta terminal tiene cargada la ${info.ot}.`],
    qr: ['QR de la máquina vecina', `Se escaneó ${codigos.qr}, el QR de la máquina de al lado: la OT se mandó a ${info.maquina}, no a esa.`],
  }[malo];
  R.error = {
    titulo: `Error provocado: ${que[0]}`,
    terminal: r?.mensaje,
    texto: `${que[1]} La terminal revisa los tres códigos juntos al leer el QR (CP 06) y lo decide ella misma, aunque no haya señal. Por eso se bloquea, la torreta pasa a rojo y la máquina no puede producir.`,
    arreglo: 'presione "Llamar al supervisor". Él libera la terminal desde el MES y el operador repite el arranque con los códigos correctos.',
  };
}

async function bolsaConError(tipo) {
  const b = info.bascula;
  const k = info.siguiente;
  const gramos = tipo === 'peso' ? b.nominal + b.tol * 3 : b.nominal;
  $('#m-peso').value = gramos;
  pintarPeso();
  await api({ accion: 'pesar', gramos });
  await pausa(500);
  const etiq = tipo === 'peso'
    ? etiquetaSiguiente()
    : grupo('Etiquetas correlativas del sobre').find((x) => x.malo && (tipo === 'salto' ? x.nota === 'se salta una' : x.nota === 'de otra OT'))?.codigo;
  const r = await escanear(etiq);
  const que = {
    peso: ['Bolsa fuera de peso', `La bolsa ${k} pesó ${gramos} g y lo permitido es ${b.nominal} ± ${b.tol} g: le sobran piezas.`, 'se ajusta la bolsa y se vuelve a pesar. Presione Siguiente: se pesa bien y se usa la misma etiqueta.'],
    salto: ['Se saltó una etiqueta', `Tocaba la etiqueta B${k} y se escaneó ${etiq}. Si se aceptara, quedaría un hueco en la secuencia y nadie sabría qué pasó con esa bolsa.`, `se busca la etiqueta B${k} del sobre. Presione Siguiente para registrarla.`],
    ajena: ['Etiqueta de otra OT', `Se escaneó ${etiq}, que es del sobre de otra orden. Esa bolsa se contaría en una OT equivocada.`, 'se retira la etiqueta y se usa la de esta OT. Presione Siguiente.'],
  }[tipo];
  R.error = {
    titulo: `Error provocado: ${que[0]}`,
    terminal: r?.mensaje,
    texto: `${que[1]} La terminal rechaza la bolsa (CP 07 en rojo), pero la máquina no se bloquea; el rechazo queda guardado en el MES. La bolsa no cuenta: el contador sigue en ${k} de ${info.totalBolsas}.`,
    arreglo: que[2],
  };
}

async function alternarSenal() {
  const cortar = !vista?.sinSenal;
  $('#m-senal-btn').click();
  await pausa(600);
  R.error = cortar
    ? { tipo: 'aviso', titulo: 'Señal LoRa cortada', texto: 'Es como si la terminal quedara fuera del alcance de la antena. Siga con Siguiente: la terminal valida igual, porque lo decide ella misma, y lo que no puede enviar se guarda en "Memoria de la terminal" (abajo a la izquierda) y en la última línea de la pantalla.', arreglo: 'al devolver la señal, la terminal reenvía todo lo guardado, en orden. No se pierde nada.' }
    : { tipo: 'bien', titulo: 'Señal LoRa restablecida', texto: 'La terminal está reenviando lo que tenía en memoria. Fíjese cómo baja el contador de memoria hasta quedar vacío y cómo llegan los eventos al MES.' };
}

function opcionesError(paso) {
  if (!info?.manual || R.ocupado) return [];
  const ops = [];
  const hay = (titulo, pred) => grupo(titulo).some((x) => x.malo && (!pred || pred(x)));
  if (!info.bloqueado && ['gafete', 'ot', 'qr'].includes(paso)) {
    ops.push(['Gafete no habilitado', () => arranqueConError('gafete')]);
    if (hay('Carpeta de la OT')) ops.push(['Carpeta de otra máquina', () => arranqueConError('ot')]);
    ops.push(['QR de la máquina vecina', () => arranqueConError('qr')]);
  }
  if (['bolsa', 'charola', 'resto'].includes(paso) && info.bascula) {
    ops.push(['Bolsa fuera de peso', () => bolsaConError('peso')]);
    if (hay('Etiquetas correlativas del sobre', (x) => x.nota === 'se salta una')) ops.push(['Saltarse una etiqueta', () => bolsaConError('salto')]);
    if (hay('Etiquetas correlativas del sobre', (x) => x.nota === 'de otra OT')) ops.push(['Etiqueta de otra OT', () => bolsaConError('ajena')]);
  }
  if (['gafete', 'ot', 'qr', 'bolsa', 'charola', 'resto'].includes(paso)) ops.push([vista?.sinSenal ? 'Devolver la señal LoRa' : 'Cortar la señal LoRa', alternarSenal]);
  return ops;
}

function pintarErrores(paso) {
  const ops = opcionesError(paso);
  const clave = ops.map((o) => o[0]).join('|');
  if (clave === R.clavesErr) return; // no rehacer los botones en cada refresco: se perderían clics
  R.clavesErr = clave;
  const caja = $('#r-errores');
  caja.hidden = !ops.length;
  caja.replaceChildren(
    h('span', { text: 'Mostrar un error:' }),
    ...ops.map(([texto, fn]) => {
      const b = h('button', { type: 'button', class: 'btn-error', text: texto });
      b.onclick = async () => {
        if (R.ocupado) return;
        R.ocupado = true;
        pintarRecorrido();
        try {
          await fn();
        } finally {
          R.ocupado = false;
          await cargarEtiquetas();
        }
      };
      return b;
    }));
}
