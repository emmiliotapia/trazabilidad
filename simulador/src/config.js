// Configuración general de la simulación. Todo se puede sobreescribir con variables de entorno.
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const CONFIG = {
  mqtt: {
    puerto: num(process.env.PUERTO_MQTT, 1883),
    prefijo: process.env.PREFIJO_MQTT || 'aseti/p1',
  },
  http: { puerto: num(process.env.PUERTO_HTTP, 8080) },
  // Interfaz de red para HTTP y MQTT. En un servidor público use 127.0.0.1 y publique el panel con nginx.
  host: process.env.HOST || '0.0.0.0',

  // Radio LoRa (US915, sin duty cycle; un solo canal en la opción A)
  lora: {
    sf: 7,
    bw: 125000,
    cr: 1, // 4/5
    preambulo: 8,
    perdidaBase: num(process.env.PERDIDA, 0.02), // probabilidad de perder una trama por ruido
  },

  // Clave de red para firmar las tramas (HMAC truncado). En producción, una clave por nodo provisionada.
  claveRed: process.env.CLAVE_RED || 'aseti-demo-clave-2026',

  // Comportamiento del nodo (firmware)
  nodo: {
    esperaAckMs: 2500, // tiempo de espera del ACK (tiempo simulado)
    maxIntentos: 4, // intentos antes de pasar a "sin enlace"
    reintentoLargoMs: 20000, // cada cuánto reintenta cuando no hay enlace
    capacidadBufer: 500, // eventos guardados en flash
    latidoMs: 120000, // mensaje de estado
  },

  // Producción simulada
  produccion: {
    velocidad: num(process.env.VELOCIDAD, 10), // 1 = tiempo real
    inyectoras: num(process.env.INYECTORAS, 22),
    bolsasPorOT: num(process.env.BOLSAS_OT, 12), // múltiplo de bolsasPorCaja
    bolsasPorCaja: 4, // divisiones en la pantalla AV (1/4..4/4) = bolsas por charola
    intervaloBolsaMs: num(process.env.INTERVALO_BOLSA, 90000), // cada cuánto sale una bolsa por máquina
    tasaFallasAleatorias: num(process.env.TASA_FALLAS, 0.0),
  },
};
