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

  // Radio LoRa (US915, sin duty cycle). Un solo gateway multicanal: cada línea transmite en su propio
  // canal y las estaciones compartidas en otro, así las terminales de una línea no chocan con las de otra.
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
    // Inyectoras por línea. LINEAS=22,20,9 → L1 con 22, L2 con 20, L3 con 9. INYECTORAS=n deja una sola línea.
    lineas: (process.env.LINEAS || (process.env.INYECTORAS ? String(process.env.INYECTORAS) : '22,20,9')).split(',').map(Number).filter((n) => n > 0),
    bolsasPorOT: num(process.env.BOLSAS_OT, 12), // múltiplo de bolsasPorCaja
    // Estaciones compartidas por las 3 líneas (supuestos a validar con la planta)
    operadoresResina: num(process.env.OPERADORES_RESINA, 3), // CP 04, en paralelo
    mesasSM1: num(process.env.MESAS_SM1, 4), // CP 11–12, una terminal por mesa
    puestosPT: num(process.env.PUESTOS_PT, 2), // CP 14, una terminal por puesto de paletizado
    bolsasPorCaja: 4, // divisiones en la pantalla AV (1/4..4/4) = bolsas por charola
    intervaloBolsaMs: num(process.env.INTERVALO_BOLSA, 90000), // cada cuánto sale una bolsa por máquina
    tasaFallasAleatorias: num(process.env.TASA_FALLAS, 0.0),
  },
};
