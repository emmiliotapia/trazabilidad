// Página de mantenimiento ASETI. Todo lo que pide al servidor lleva la clave en Authorization.
import { $, h, hora } from './comun.js';

let clave = sessionStorage.getItem('aseti-clave') ?? '';

async function api(ruta, opciones = {}) {
  const r = await fetch(`/api/aseti/${ruta}`, { ...opciones, headers: { ...opciones.headers, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' } });
  if (r.status === 401 || r.status === 429) {
    const { error } = await r.json();
    salir(error);
    throw new Error(error);
  }
  if (!r.ok) throw new Error(`Error ${r.status}`);
  return r.json();
}

function salir(mensaje = '') {
  clave = '';
  sessionStorage.removeItem('aseti-clave');
  $('#contenido').hidden = true;
  $('#salir').hidden = true;
  $('#form-clave').hidden = false;
  $('#error-clave').textContent = mensaje;
  $('#clave').focus();
}

$('#form-clave').onsubmit = async (e) => {
  e.preventDefault();
  clave = $('#clave').value;
  try {
    await cargar();
    sessionStorage.setItem('aseti-clave', clave);
    $('#clave').value = '';
  } catch {
    /* salir() ya mostró el error */
  }
};
$('#salir').onclick = () => salir();
$('#actualizar').onclick = () => cargar();
$('#descargar').onclick = async () => {
  const r = await fetch('/api/aseti/diagnostico.json', { headers: { Authorization: `Bearer ${clave}` } });
  if (!r.ok) return;
  const a = h('a', { href: URL.createObjectURL(await r.blob()), download: `diagnostico-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
};

async function cargar() {
  const [d, a] = await Promise.all([api('diagnostico'), api('acciones')]);
  $('#form-clave').hidden = true;
  $('#contenido').hidden = false;
  $('#salir').hidden = false;
  pintarDiagnostico(d);
  pintarAcciones(a);
}

const datos = (pares) => pares.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: String(v) })));

function pintarDiagnostico(d) {
  $('#generado').textContent = `${hora(d.generado)} · versión ${d.version} · reloj simulado ${hora(d.relojSimulado)}`;
  $('#chequeos').replaceChildren(...d.chequeos.map((c) => h('li', { 'data-ok': String(c.ok) },
    h('span', { class: 'aseti-marca', text: c.ok ? 'Bien' : 'Revisar' }), h('strong', { text: c.nombre }), h('span', { text: c.detalle }))));
  $('#problemas').replaceChildren(...(d.terminalesConProblema.length
    ? d.terminalesConProblema.map((p) => h('li', {}, h('strong', { text: p.nombre }), ` ${p.motivos.join(' · ')}`))
    : [h('li', { class: 'vacio', text: 'Todas las terminales están bien.' })]));
  $('#errores').replaceChildren(...(d.errores.length
    ? d.errores.map((e) => h('li', { 'data-nivel': e.nivel }, h('time', { text: hora(e.ts) }), ` ${e.texto}`))
    : [h('li', { class: 'vacio', text: 'Sin errores desde que arrancó.' })]));
  $('#base').replaceChildren(...datos([['Archivo', `${d.base.archivoMB} MB`], ['Registro WAL', `${d.base.walMB} MB`], ['Eventos', d.mes.eventos], ['Alertas', d.mes.alertas], ['Despachos', d.mes.despachos]]));
  $('#tablas').replaceChildren(...d.base.tablas.map((t) => h('tr', {}, h('td', { text: t.tabla }), h('td', { text: t.filas.toLocaleString('es-MX') }))));
  $('#proceso').replaceChildren(...datos([
    ['Node.js', d.proceso.node], ['Activo', `${d.proceso.activoMin} min`], ['Memoria', `${d.proceso.memoriaMB.rss} MB (heap ${d.proceso.memoriaMB.heap} MB)`],
    ['Equipo', `${d.equipo.host} · ${d.equipo.sistema}`], ['CPU', `${d.equipo.cpus} núcleos · carga ${d.equipo.carga.join(' / ')}`],
    ['Memoria del equipo', `${d.equipo.memoriaLibreMB} MB libres de ${d.equipo.memoriaTotalMB} MB`],
    ['Radio', `${d.radio.tramas} tramas · ocupación ${d.radio.ocupacion}`], ['Puente', `${d.puente.publicadas} publicadas · ${d.puente.rechazadas} rechazadas`],
    ['Voceo', `${d.voceo.voceados} voceados · ${d.voceo.omitidos} omitidos${d.voceo.bloqueosAbiertos.length ? ` · sin atender: ${d.voceo.bloqueosAbiertos.join(', ')}` : ''}`],
  ]));
}

function pintarAcciones({ acciones, auditoria }) {
  $('#acciones').replaceChildren(...acciones.map((a) => {
    const salida = h('p', { class: 'aseti-salida', 'aria-live': 'polite' });
    const boton = h('button', { type: 'button', class: 'btn secundario', text: 'Ejecutar' });
    boton.onclick = async () => {
      if (a.confirmar && boton.dataset.armado !== '1') {
        boton.dataset.armado = '1';
        boton.textContent = '¿Seguro? Clic otra vez';
        setTimeout(() => {
          delete boton.dataset.armado;
          boton.textContent = 'Ejecutar';
        }, 4000);
        return;
      }
      delete boton.dataset.armado;
      boton.textContent = 'Ejecutar';
      boton.disabled = true;
      salida.textContent = 'Ejecutando…';
      try {
        const r = await api('accion', { method: 'POST', body: JSON.stringify({ id: a.id }) });
        salida.dataset.ok = String(r.ok);
        salida.textContent = r.mensaje;
      } catch (e) {
        salida.dataset.ok = 'false';
        salida.textContent = e.message;
      }
      boton.disabled = false;
      api('acciones').then((x) => pintarAuditoria(x.auditoria)).catch(() => {});
    };
    return h('li', {}, h('div', {}, h('strong', { text: a.titulo }), h('span', { text: a.descripcion }), salida), boton);
  }));
  pintarAuditoria(auditoria);
}

function pintarAuditoria(lista) {
  $('#auditoria').replaceChildren(...(lista.length
    ? lista.map((l) => h('li', { 'data-nivel': l.ok ? '' : 'error' }, h('time', { text: `${new Date(l.ts).toLocaleString('es-MX', { hour12: false })}` }), ` ${l.accion} · ${l.ip} · ${l.mensaje ?? ''}`))
    : [h('li', { class: 'vacio', text: 'Todavía no se ha ejecutado ninguna acción.' })]));
}

if (clave) cargar().catch(() => {});
else $('#clave').focus();
