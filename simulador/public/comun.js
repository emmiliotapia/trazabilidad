// Utilidades compartidas del panel
export const $ = (s) => document.querySelector(s);

export const h = (tag, props = {}, ...hijos) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.includes('-')) el.setAttribute(k, v);
    else el[k] = v;
  }
  for (const c of hijos.flat()) if (c != null) el.append(c);
  return el;
};

export const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { hour12: false }) : '');

// Desarma una trama del protocolo v1 en segmentos con su significado.
// meta: { tipos, campos, fallasCodigo, cmds } (lo manda el servidor al conectar)
export function segmentar(hex, meta) {
  const b = hex.split(' ').map((x) => parseInt(x, 16));
  const segs = [];
  const tipo = b[0] & 0x0f;
  const nombreTipo = Object.keys(meta.tipos).find((k) => meta.tipos[k] === tipo) ?? '?';
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const u32 = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const add = (cls, i, n, etiqueta) => segs.push({ cls, bytes: b.slice(i, i + n), etiqueta });
  const tsTxt = (i) => hora(new Date(u32(i) * 1000).toISOString());
  add('cab', 0, 1, `v${b[0] >> 4} · ${nombreTipo}`);
  add('cab', 1, 2, `nodo ${u16(1)}`);
  add('cab', 3, 2, `seq ${u16(3)}`);
  let i = 5;
  if (nombreTipo === 'EVENTO') {
    add('fijo', 5, 1, `CP ${b[5]}`);
    add('fijo', 6, 1, meta.fallasCodigo[b[6]] ?? b[6]);
    add('fijo', 7, 4, `hora ${tsTxt(7)}`);
    i = 11;
  } else if (nombreTipo === 'ESTADO') {
    add('fijo', 5, 4, `hora ${tsTxt(5)}`);
    add('fijo', 9, 2, `búfer ${u16(9)}`);
    add('fijo', 11, 1, b[11] ? 'bloqueado' : 'libre');
    i = 12;
  } else if (nombreTipo === 'ACK') {
    add('fijo', 5, 2, `confirma seq ${u16(5)}`);
    add('fijo', 7, 4, `hora ${tsTxt(7)}`);
    i = 11;
  } else if (nombreTipo === 'CMD') {
    add('fijo', 5, 1, meta.cmds[b[5]] ?? b[5]);
    i = 6;
  } else if (nombreTipo === 'CMD_ACK') {
    add('fijo', 5, 2, `cmd seq ${u16(5)}`);
    add('fijo', 7, 1, meta.fallasCodigo[b[7]] ?? b[7]);
    i = 8;
  }
  const porTag = Object.fromEntries(Object.entries(meta.campos).map(([n, [t, tipoC]]) => [t, [n, tipoC]]));
  const fin = b.length - 4;
  while (i + 2 <= fin) {
    const [nombre, tipoC] = porTag[b[i]] ?? [`tag ${b[i]}`, 's'];
    const largo = b[i + 1];
    const v = b.slice(i + 2, i + 2 + largo);
    let valor;
    if (tipoC === 's' || tipoC === 'l') valor = String.fromCharCode(...v);
    else if (tipoC === 'u8') valor = v[0];
    else valor = (v[0] << 8) | v[1];
    segs.push({ cls: 'tlv', bytes: b.slice(i, i + 2), etiqueta: `${nombre} · ${largo} B` });
    segs.push({ cls: 'tlv', bytes: v, etiqueta: `${valor}` });
    i += 2 + largo;
  }
  add('firma', fin, 4, 'firma HMAC');
  return segs;
}

export function dibujarSegmentos(segs) {
  return segs.map((s) =>
    h('span', { class: `seg ${s.cls}` }, h('code', { text: s.bytes.map((x) => x.toString(16).padStart(2, '0')).join(' ') }), h('small', { text: s.etiqueta })),
  );
}

export const LEYENDA_TRAMA = [
  ['var(--rol-charolero)', 'Cabecera: versión, tipo, nodo y número de mensaje'],
  ['var(--rol-plan)', 'Campos fijos del tipo de mensaje'],
  ['var(--rol-prod)', 'Datos variables (etiqueta, largo, valor)'],
  ['var(--rol-pt)', 'Firma para detectar tramas falsas o alteradas'],
];
