// Pestaña Configuración: colores de estado (los del cliente), colores de checkpoints, nombre de la planta
// y reglas del voceo. Se guardan en el servidor (datos/ajustes.json) y llegan a todos los paneles abiertos.
import { $, h } from './comun.js';

const ROLES_VOCEO = {
  supervisor: 'Supervisor', mantenimiento: 'Mantenimiento', calidad: 'Calidad', moldes: 'Técnico de moldes',
  materiales: 'Surtidor de resina', charolero: 'Charolero', montacargas: 'Montacargas', primeros_auxilios: 'Primeros auxilios',
};
const NOMBRE_ESTADO = { verde: 'Verde', ambar: 'Ámbar', rojo: 'Rojo', gris: 'Gris' };
const USO_ESTADO = {
  verde: 'Máquina produciendo, gate en PASS', ambar: 'Esperando OT, arranque o ajuste', rojo: 'Bloqueada o con falla', gris: 'Sin OT asignada',
};

let actual = null;
let meta = null;

// ───────────── aplicar al panel ─────────────
export function aplicar(v) {
  actual = v;
  const raiz = document.documentElement.style;
  for (const [k, e] of Object.entries(v.estados)) {
    raiz.setProperty(`--${k}`, e.color);
    raiz.setProperty(`--${k}-texto`, textoSobre(e.color));
  }
  for (const [k, r] of Object.entries(v.roles)) raiz.setProperty(`--rol-${k}`, r.color);
  raiz.setProperty('--barra', v.barra);
  const h1 = document.querySelector('.marca h1');
  const p = document.querySelector('.marca p');
  if (h1) h1.textContent = v.planta.nombre;
  if (p) p.textContent = v.planta.subtitulo;
  document.title = `${v.planta.nombre} · Simulador`;
}

export const nombreEstado = (k) => actual?.estados?.[k]?.nombre ?? NOMBRE_ESTADO[k];

// Negro o blanco, lo que se lea mejor sobre ese color (contraste WCAG)
function textoSobre(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#111111';
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (r, g, b) => `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;

// Acepta "#1f8a4c", "1f8a4c", "31, 138, 76", "rgb(31 138 76)"
export function leerColor(texto) {
  const t = texto.trim().toLowerCase();
  let m = /^#?([0-9a-f]{6})$/.exec(t);
  if (m) return `#${m[1]}`;
  m = /^#?([0-9a-f]{3})$/.exec(t);
  if (m) return `#${[...m[1]].map((c) => c + c).join('')}`;
  m = /^(?:rgb\()?\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)?$/.exec(t);
  if (m && m.slice(1).every((x) => Number(x) <= 255)) return hex(+m[1], +m[2], +m[3]);
  return null;
}

// ───────────── formulario ─────────────
export function configurar(m) {
  meta = m;
  aplicar(m.ajustes);
  llenar(m.ajustes);
}

// Otro panel guardó: se aplica aquí también, salvo que este usuario esté editando
export function alCambiar(v) {
  aplicar(v);
  if (!$('#form-config').dataset.sucio) llenar(v);
}

function filaColor(grupo, k, e, uso) {
  const muestra = h('span', { class: `cfg-muestra ${grupo === 'estados' ? 'luz' : 'cp-muestra'}`, text: grupo === 'estados' ? '07' : '' });
  const picker = h('input', { type: 'color', value: e.color, 'aria-label': `Color de ${e.nombre}` });
  const campo = h('input', { type: 'text', value: textoRGB(e.color), class: 'cfg-rgb', spellcheck: false, 'aria-label': `RGB o hexadecimal de ${e.nombre}`, placeholder: '31, 138, 76 o #1f8a4c' });
  const nombre = h('input', { type: 'text', value: e.nombre, maxLength: 30, 'aria-label': 'Nombre que se muestra' });
  const pintar = (c) => {
    muestra.style.background = c;
    muestra.style.color = textoSobre(c);
  };
  pintar(e.color);
  picker.oninput = () => {
    campo.value = textoRGB(picker.value);
    campo.removeAttribute('aria-invalid');
    pintar(picker.value);
  };
  campo.oninput = () => {
    const c = leerColor(campo.value);
    campo.toggleAttribute('aria-invalid', !c);
    if (c) {
      picker.value = c;
      pintar(c);
    }
  };
  const fila = h('div', { class: 'cfg-fila' }, muestra,
    h('div', { class: 'cfg-quien' }, h('strong', { text: grupo === 'estados' ? NOMBRE_ESTADO[k] : k }), uso ? h('span', { text: uso }) : null),
    h('label', {}, 'Nombre', nombre),
    h('label', {}, 'Color', h('span', { class: 'cfg-color' }, picker, campo)));
  fila.leer = () => ({ color: leerColor(campo.value) ?? e.color, nombre: nombre.value.trim() || e.nombre });
  return fila;
}

const textoRGB = (c) => rgb(c).join(', ');

function llenar(v) {
  const f = $('#form-config');
  delete f.dataset.sucio;
  $('#cfg-nombre').value = v.planta.nombre;
  $('#cfg-subtitulo').value = v.planta.subtitulo;
  $('#cfg-barra').value = v.barra;

  f.filasEstado = Object.entries(v.estados).map(([k, e]) => [k, filaColor('estados', k, e, USO_ESTADO[k])]);
  $('#cfg-estados').replaceChildren(...f.filasEstado.map(([, fila]) => fila));
  f.filasRol = Object.entries(v.roles).map(([k, r]) => [k, filaColor('roles', k, r)]);
  $('#cfg-roles').replaceChildren(...f.filasRol.map(([, fila]) => fila));

  const vo = v.voceo;
  $('#cfg-v-activo').checked = vo.activo;
  for (const k of ['repetir', 'maxAtrasoMin', 'silencioMin', 'escalarMin', 'maxEscalamientos']) $(`#cfg-v-${k}`).value = vo[k];
  const roles = [...new Set((meta?.avisos ?? []).map((a) => a.rol).filter(Boolean))];
  const opciones = (sel) => [h('option', { value: '', text: 'No vocear (solo panel)' }), ...roles.map((r) => h('option', { value: r, text: ROLES_VOCEO[r] ?? r }))]
    .map((o) => ((o.selected = o.value === sel), o));
  $('#cfg-reglas tbody').replaceChildren(...Object.entries(vo.reglas).map(([codigo, rol]) =>
    h('tr', {}, h('td', {}, h('code', { text: codigo })), h('td', { text: meta?.textosFalla?.[codigo] ?? '' }),
      h('td', {}, h('select', { 'data-codigo': codigo, 'aria-label': `A quién llama ${codigo}` }, ...opciones(rol))))));
  $('#cfg-estado').textContent = '';
}

function leerFormulario() {
  const f = $('#form-config');
  const invalido = f.querySelector('[aria-invalid]');
  if (invalido) {
    invalido.focus();
    throw new Error('Hay un color que no se entiende. Use 31, 138, 76 o #1f8a4c.');
  }
  return {
    planta: { nombre: $('#cfg-nombre').value, subtitulo: $('#cfg-subtitulo').value },
    barra: $('#cfg-barra').value,
    estados: Object.fromEntries(f.filasEstado.map(([k, fila]) => [k, fila.leer()])),
    roles: Object.fromEntries(f.filasRol.map(([k, fila]) => [k, fila.leer()])),
    voceo: {
      activo: $('#cfg-v-activo').checked,
      ...Object.fromEntries(['repetir', 'maxAtrasoMin', 'silencioMin', 'escalarMin', 'maxEscalamientos'].map((k) => [k, Number($(`#cfg-v-${k}`).value)])),
      reglas: Object.fromEntries([...document.querySelectorAll('#cfg-reglas select')].map((s) => [s.dataset.codigo, s.value])),
    },
  };
}

$('#form-config').oninput = (e) => {
  $('#form-config').dataset.sucio = '1';
  $('#cfg-estado').textContent = 'Cambios sin guardar';
  // vista previa en vivo de los colores sin guardar
  if (e.target.type === 'color' || e.target.classList.contains('cfg-rgb') || e.target.id === 'cfg-barra') {
    try {
      aplicar({ ...actual, ...leerFormulario(), planta: actual.planta });
    } catch {
      /* color a medio escribir */
    }
  }
};

$('#form-config').onsubmit = async (e) => {
  e.preventDefault();
  let datos;
  try {
    datos = leerFormulario();
  } catch (err) {
    $('#cfg-estado').textContent = err.message;
    return;
  }
  const r = await fetch('/api/ajustes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
  if (!r.ok) {
    $('#cfg-estado').textContent = `No se pudo guardar (${r.status})`;
    return;
  }
  const v = await r.json();
  aplicar(v);
  llenar(v);
  $('#cfg-estado').textContent = `Guardado ${new Date().toLocaleTimeString('es-MX', { hour12: false })}. Se aplica en todos los paneles abiertos.`;
};

$('#cfg-deshacer').onclick = async () => {
  const v = await (await fetch('/api/ajustes')).json();
  aplicar(v);
  llenar(v);
  $('#cfg-estado').textContent = 'Se volvió a lo guardado';
};
