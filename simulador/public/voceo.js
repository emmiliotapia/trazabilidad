// Voceo en el panel: hace de "conmutador" de prueba. Cuando el MES publica en {prefijo}/voceo,
// este navegador toca el timbre y reproduce el MP3 de voceo/salida (o, si falta, la voz del navegador).
import { $, h, hora } from './comun.js';

const ROLES = {
  supervisor: 'Supervisor', mantenimiento: 'Mantenimiento', calidad: 'Calidad', moldes: 'Técnico de moldes',
  materiales: 'Surtidor de resina', charolero: 'Charolero', montacargas: 'Montacargas', primeros_auxilios: 'Primeros auxilios',
};
const ESTADO = { voceado: 'Voceado', omitido: 'No se voceó', resuelto: 'Resuelto' };

let avisos = [];
let sonido = false;
let ctx = null;
const cola = [];
let tocando = false;

export function configurar(meta) {
  avisos = meta.avisos ?? [];
  const roles = [...new Set(avisos.filter((a) => a.tipo === 'llamado').map((a) => a.rol))];
  $('#v-rol').replaceChildren(
    ...roles.map((r) => h('option', { value: r, text: ROLES[r] ?? r })),
    avisos.some((a) => a.tipo === 'general') ? h('option', { value: '__general', text: 'Aviso general' }) : null,
  );
  llenarDestinos();
  $('#v-rol').onchange = llenarDestinos;
  $('#v-sin-catalogo').hidden = avisos.length > 0;
}

function llenarDestinos() {
  const rol = $('#v-rol').value;
  const lista = rol === '__general' ? avisos.filter((a) => a.tipo === 'general') : avisos.filter((a) => a.rol === rol);
  $('#v-destino').replaceChildren(...lista.map((a) => h('option', { value: a.clave, text: rol === '__general' ? a.texto : a.destino })));
}

$('#v-sonido').onclick = () => {
  sonido = !sonido;
  $('#v-sonido').setAttribute('aria-pressed', String(sonido));
  $('#v-sonido').textContent = sonido ? 'Sonido activado en esta computadora' : 'Activar sonido en esta computadora';
  if (sonido) {
    ctx ??= new AudioContext();
    ctx.resume();
  } else {
    cola.length = 0;
    speechSynthesis.cancel();
  }
};

$('#form-voceo').onsubmit = (e) => {
  e.preventDefault();
  if (!sonido) $('#v-sonido').click(); // quien prueba un aviso quiere oírlo
  fetch('/api/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'probarVoceo', clave: $('#v-destino').value }) });
};

// Cada mensaje del broker: solo nos interesan los de voceo
export function alMQTT(m) {
  if (m.topico !== 'voceo' || !sonido) return;
  cola.push(m.json);
  if (!tocando) siguiente();
}

async function siguiente() {
  const a = cola.shift();
  if (!a) {
    tocando = false;
    $('#v-ahora').textContent = '';
    return;
  }
  tocando = true;
  const texto = a.texto ?? a.archivo.replace('.mp3', '').replaceAll('__', ' a ').replaceAll('_', ' ');
  for (let i = 0; i < (a.repetir ?? 1); i++) {
    if (!sonido) break;
    $('#v-ahora').textContent = `Sonando${a.repetir > 1 ? ` (${i + 1} de ${a.repetir})` : ''}: ${texto}`;
    await timbre();
    const ok = await tocarMP3(`/voceo/${a.archivo}`);
    if (!ok) {
      $('#v-ahora').textContent += ' · falta el MP3, se usa la voz del navegador';
      await hablar(texto);
    }
    await pausa(700);
  }
  siguiente();
}

function tocarMP3(url) {
  return new Promise((ok) => {
    const audio = new Audio(url);
    audio.onended = () => ok(true);
    audio.onerror = () => ok(false);
    audio.play().catch(() => ok(false));
  });
}

function hablar(texto) {
  return new Promise((ok) => {
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-MX';
    u.rate = 0.95;
    u.onend = ok;
    u.onerror = ok;
    speechSynthesis.speak(u);
  });
}

// Timbre de dos tonos, como el de un sistema de voceo
async function timbre() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [f, d] of [[880, 0], [660, 0.32]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start(t + d);
    o.stop(t + d + 0.65);
  }
  await pausa(1000);
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export function alEstado(est) {
  const v = est.voceo;
  if (!v) return;
  $('#v-stats').textContent = `${v.stats.voceados} voceados · ${v.stats.omitidos} sin vocear${v.abiertos.length ? ` · bloqueadas sin atender: ${v.abiertos.join(', ')}` : ''}`;
  const ul = $('#v-historial');
  ul.replaceChildren(...(v.historial.length
    ? v.historial.map((r) => h('li', { 'data-estado': r.estado },
      h('span', { class: 'hora', text: hora(r.ts) }),
      h('span', { class: 'v-estado', text: r.escalamiento ? `${ESTADO[r.estado]} otra vez` : ESTADO[r.estado] }),
      h('span', {},
        r.texto ?? r.clave ?? r.codigo,
        h('div', { class: 'quien', text: [r.codigo && `${r.codigo}${r.cp ? ` · CP ${r.cp}` : ''}`, r.nodo, r.motivo].filter(Boolean).join(' · ') })),
      r.estado === 'voceado'
        ? h('button', { type: 'button', class: 'v-oir', text: 'Oír', title: 'Reproducir este aviso en esta computadora', onclick: () => oir(r) })
        : h('span'),
    ))
    : [h('li', { class: 'vacio', text: 'Todavía no hay avisos. Programe una falla o pruebe un aviso.' })]));
}

function oir(r) {
  if (!sonido) $('#v-sonido').click();
  cola.push({ archivo: r.archivo, texto: r.texto, repetir: 1 });
  if (!tocando) siguiente();
}
