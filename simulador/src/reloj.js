// Reloj simulado: permite acelerar todo (producción, tiempo en aire, timeouts) con un solo factor.
export class Reloj {
  constructor(velocidad = 1) {
    this.velocidad = velocidad;
    this.baseReal = Date.now();
    this.baseSim = Date.now();
  }

  ahora() {
    return this.baseSim + (Date.now() - this.baseReal) * this.velocidad;
  }

  setVelocidad(v) {
    this.baseSim = this.ahora();
    this.baseReal = Date.now();
    this.velocidad = Math.max(0.1, Math.min(60, v));
  }

  // Programa una función dentro de `ms` milisegundos SIMULADOS.
  timeout(fn, ms) {
    return setTimeout(fn, Math.max(0, ms / this.velocidad));
  }

  esperar(ms) {
    return new Promise((r) => this.timeout(r, ms));
  }

  iso(ms = this.ahora()) {
    return new Date(ms).toISOString();
  }
}

// Utilidades de azar
export const azar = (min, max) => min + Math.random() * (max - min);
export const elegir = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const normal = (media, desv) => {
  const u = 1 - Math.random();
  const v = Math.random();
  return media + desv * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// Cola de exclusión mutua para estaciones compartidas (SM1, almacén PT, cámara)
export class Turno {
  constructor() {
    this.cola = Promise.resolve();
  }
  run(fn) {
    const r = this.cola.then(fn);
    this.cola = r.catch(() => {});
    return r;
  }
}
