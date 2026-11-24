// Ajustes del panel que se cambian sin tocar código: colores de estado (los del cliente), colores de los
// checkpoints, nombre de la planta y reglas del voceo. Se guardan en datos/ajustes.json y se aplican al momento.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { REGLAS } from './mes/voceo.js';

export const PREDETERMINADOS = {
  planta: { nombre: 'Trazabilidad de inyección', subtitulo: 'Simulación: nodos LoRa → gateway → MQTT → MES' },
  estados: {
    verde: { color: '#1f8a4c', nombre: 'Produciendo' },
    ambar: { color: '#b97f00', nombre: 'Esperando' },
    rojo: { color: '#c2362f', nombre: 'En falla' },
    gris: { color: '#8795a1', nombre: 'Sin OT' },
  },
  roles: {
    mp: { color: '#fce4d6', nombre: 'Almacén MP' },
    plan: { color: '#fff2cc', nombre: 'Planificación' },
    prod: { color: '#e2efda', nombre: 'Producción' },
    cal1: { color: '#ffd966', nombre: 'Calidad 1' },
    charolero: { color: '#d9e1f2', nombre: 'Charolero' },
    pt: { color: '#f8cbad', nombre: 'Almacén PT' },
  },
  barra: '#1e2b35',
  voceo: {
    activo: true,
    repetir: 2,
    maxAtrasoMin: 2,
    silencioMin: 5,
    escalarMin: 5,
    maxEscalamientos: 2,
    // código de alerta → rol que se llama ('' = no se vocea)
    reglas: {
      ...Object.fromEntries(Object.entries(REGLAS).map(([c, r]) => [c, r.rol])),
      PESO_FUERA_TOLERANCIA: '', SECUENCIA_ROTA: '', CAJA_SIN_ENCINTAR: '', CAJA_INCOMPLETA: '', CAJA_LLENA: '', CAMARA_NO_CONFIRMA: '',
    },
  },
};

const COLOR = /^#[0-9a-f]{6}$/i;
const copia = (o) => JSON.parse(JSON.stringify(o));

export class Ajustes extends EventEmitter {
  constructor(ruta, { roles = [] } = {}) {
    super();
    this.ruta = ruta;
    this.rolesVoceo = roles; // roles con avisos grabados
    this.valor = copia(PREDETERMINADOS);
    if (existsSync(ruta)) {
      try {
        this.valor = this.validar(JSON.parse(readFileSync(ruta, 'utf8')));
      } catch (e) {
        console.warn(`Ajustes: ${ruta} no es válido (${e.message}); se usan los predeterminados.`);
      }
    }
  }

  get() {
    return this.valor;
  }

  guardar(nuevo) {
    this.valor = this.validar(nuevo);
    mkdirSync(dirname(this.ruta), { recursive: true });
    writeFileSync(`${this.ruta}.tmp`, JSON.stringify(this.valor, null, 2));
    renameSync(`${this.ruta}.tmp`, this.ruta);
    this.emit('cambio', this.valor);
    return this.valor;
  }

  restablecer() {
    return this.guardar(copia(PREDETERMINADOS));
  }

  // Parte de los predeterminados y solo acepta lo que tiene forma correcta: un archivo viejo o a medias no rompe nada.
  validar(n = {}) {
    const v = copia(PREDETERMINADOS);
    const texto = (x, max, d) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : d);
    const color = (x, d) => (typeof x === 'string' && COLOR.test(x) ? x.toLowerCase() : d);
    const entero = (x, min, max, d) => (Number.isFinite(Number(x)) ? Math.min(max, Math.max(min, Math.round(Number(x)))) : d);

    v.planta.nombre = texto(n.planta?.nombre, 60, v.planta.nombre);
    v.planta.subtitulo = texto(n.planta?.subtitulo, 90, v.planta.subtitulo);
    for (const grupo of ['estados', 'roles']) {
      for (const k of Object.keys(v[grupo])) {
        v[grupo][k].color = color(n[grupo]?.[k]?.color, v[grupo][k].color);
        v[grupo][k].nombre = texto(n[grupo]?.[k]?.nombre, 30, v[grupo][k].nombre);
      }
    }
    v.barra = color(n.barra, v.barra);

    const vo = n.voceo ?? {};
    v.voceo.activo = typeof vo.activo === 'boolean' ? vo.activo : v.voceo.activo;
    v.voceo.repetir = entero(vo.repetir, 1, 3, v.voceo.repetir);
    v.voceo.maxAtrasoMin = entero(vo.maxAtrasoMin, 1, 60, v.voceo.maxAtrasoMin);
    v.voceo.silencioMin = entero(vo.silencioMin, 1, 60, v.voceo.silencioMin);
    v.voceo.escalarMin = entero(vo.escalarMin, 1, 60, v.voceo.escalarMin);
    v.voceo.maxEscalamientos = entero(vo.maxEscalamientos, 0, 5, v.voceo.maxEscalamientos);
    for (const codigo of Object.keys(v.voceo.reglas)) {
      const rol = vo.reglas?.[codigo];
      if (rol === '' || (typeof rol === 'string' && (!this.rolesVoceo?.length || this.rolesVoceo.includes(rol)))) v.voceo.reglas[codigo] = rol;
    }
    return v;
  }
}
