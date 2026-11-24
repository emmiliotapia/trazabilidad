// Gate local de cada terminal (lo que correrá en el ESP32) y el manejo de búfer, ACK y comandos.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NodoInyectora, NodoMezanina, NodoSM1, NodoAlmacenPT, NodoVision, NodoAlmacenMP } from '../src/nodo/estaciones.js';
import { codificar, decodificar, TIPO, CMD, FALLA } from '../src/protocolo/trama.js';
import { crearNodo, relojFalso, canalFalso } from './ayuda.js';

const OT = 'OT-2611-018';
const cargarOT = (n) => n.manejarComando(CMD.CARGAR_OT, { ot: OT, skuProducto: 'CONT-500-PE', total: 8, pesoNominal: 2400, tolerancia: 40, operadores: ['E1034', 'E1035'] });
const arrancada = () => {
  const n = crearNodo(NodoInyectora);
  cargarOT(n);
  assert.equal(n.arrancar({ gafete: 'E1034', ot: OT, qr: n.qr }).ok, true);
  return n;
};

describe('CP 06 · arranque de inyectora', () => {
  test('gafete habilitado, OT correcta y QR de esta máquina: arranca en verde', () => {
    const n = crearNodo(NodoInyectora);
    cargarOT(n);
    const r = n.arrancar({ gafete: 'E1035', ot: OT, qr: 'QR-L1-INY-07' });
    assert.equal(r.codigo, 'PASS');
    assert.equal(n.arrancada, true);
    assert.equal(n.pantalla.color, 'verde');
  });

  for (const [caso, datos, codigo] of [
    ['operador no habilitado', { gafete: 'E9999', ot: OT, qr: 'QR-L1-INY-07' }, 'OPERADOR_NO_HABILITADO'],
    ['OT de otra máquina', { gafete: 'E1034', ot: 'OT-2611-099', qr: 'QR-L1-INY-07' }, 'OT_NO_ASIGNADA'],
    ['QR de la máquina vecina', { gafete: 'E1034', ot: OT, qr: 'QR-L1-INY-08' }, 'QR_MAQUINA_INCORRECTO'],
  ]) {
    test(`${caso}: FAIL ${codigo} y la terminal se bloquea`, () => {
      const n = crearNodo(NodoInyectora);
      cargarOT(n);
      const r = n.arrancar(datos);
      assert.equal(r.codigo, codigo);
      assert.equal(n.bloqueado, true);
      assert.equal(n.pantalla.color, 'rojo');
    });
  }

  test('sin OT cargada no se puede arrancar', () => {
    assert.equal(crearNodo(NodoInyectora).arrancar({ gafete: 'E1034', ot: OT, qr: 'QR-L1-INY-07' }).codigo, 'OT_NO_ASIGNADA');
  });

  test('bloqueada no acepta un arranque correcto hasta que llega DESBLOQUEAR', () => {
    const n = crearNodo(NodoInyectora);
    cargarOT(n);
    n.arrancar({ gafete: 'E9999', ot: OT, qr: n.qr });
    assert.equal(n.arrancar({ gafete: 'E1034', ot: OT, qr: n.qr }).codigo, 'NODO_BLOQUEADO');
    n.manejarComando(CMD.DESBLOQUEAR, {});
    assert.equal(n.arrancar({ gafete: 'E1034', ot: OT, qr: n.qr }).codigo, 'PASS');
  });

  test('el lector exige el orden gafete → OT → QR', () => {
    const n = crearNodo(NodoInyectora);
    cargarOT(n);
    assert.match(n.escanear(OT).mensaje, /gafete/);
    n.escanear('e1034'); // minúsculas: el firmware normaliza
    assert.match(n.escanear('QR-L1-INY-07').mensaje, /Orden/);
    n.escanear('E1034');
    n.escanear(OT);
    assert.equal(n.escanear('QR-L1-INY-07').evento.codigo, 'PASS');
  });
});

describe('CP 07–10 · bolsas y charolas', () => {
  test('bolsas en orden y dentro de tolerancia pasan', () => {
    const n = arrancada();
    assert.equal(n.registrarBolsa({ k: 1, peso: 2400 }).codigo, 'PASS');
    assert.equal(n.registrarBolsa({ k: 2, peso: 2440 }).codigo, 'PASS'); // justo en el límite
    assert.equal(n.siguiente, 3);
  });

  test('peso fuera de tolerancia y salto de correlativo fallan sin avanzar', () => {
    const n = arrancada();
    assert.equal(n.registrarBolsa({ k: 1, peso: 2441 }).codigo, 'PESO_FUERA_TOLERANCIA');
    assert.equal(n.registrarBolsa({ k: 2, peso: 2400 }).codigo, 'SECUENCIA_ROTA');
    assert.equal(n.siguiente, 1);
  });

  test('sin arranque no se registran bolsas', () => {
    const n = crearNodo(NodoInyectora);
    cargarOT(n);
    assert.equal(n.registrarBolsa({ k: 1, peso: 2400 }).codigo, 'GATE_PREVIO_NO_PASS');
  });

  test('una etiqueta de otra OT se rechaza en el lector', () => {
    const n = arrancada();
    n.pesar(2400);
    assert.equal(n.escanear('OT-2611-099-B001').evento.codigo, 'OT_NO_ASIGNADA');
  });

  test('charola: inspección → liberación → retiro, y un defecto la manda a cuarentena', () => {
    const n = arrancada();
    for (let k = 1; k <= 8; k++) n.registrarBolsa({ k, peso: 2400 });
    assert.equal(n.retirarCharola({ charola: 1, charolero: 'C11' }).codigo, 'GATE_PREVIO_NO_PASS'); // sin liberar
    assert.equal(n.inspeccionar({ k: 2, inspector: 'Q101', defecto: false }).codigo, 'PASS');
    assert.equal(n.liberarCharola({ charola: 1, supervisor: 'S01' }).codigo, 'PASS');
    assert.equal(n.retirarCharola({ charola: 1, charolero: 'C11' }).codigo, 'PASS');
    assert.equal(n.inspeccionar({ k: 6, inspector: 'Q101', defecto: true }).codigo, 'DEFECTO_CRITICO');
    assert.equal(n.charolas.get(2).estado, 'CUARENTENA');
    assert.equal(n.liberarCharola({ charola: 2, supervisor: 'S01' }).codigo, 'GATE_PREVIO_NO_PASS');
  });
});

describe('otras estaciones', () => {
  test('CP 01–02: un lote sin certificado no se puede subir a la mezanina', () => {
    const mp = crearNodo(NodoAlmacenMP, { id: 901, nombre: 'MP-01' });
    assert.equal(mp.recibirLote({ lote: 'L1', sku: 'RES01', proveedor: 'P', kg: 25, certificado: false, almacenista: 'A301' }).codigo, 'CERTIFICADO_INVALIDO');
    assert.equal(mp.trasladar({ lote: 'L1', ubicacion: 'MEZ', almacenista: 'A301' }).codigo, 'GATE_PREVIO_NO_PASS');
    mp.recibirLote({ lote: 'L2', sku: 'RES01', proveedor: 'P', kg: 25, certificado: true, almacenista: 'A301' });
    assert.equal(mp.trasladar({ lote: 'L2', ubicacion: 'MEZ', almacenista: 'A301' }).codigo, 'PASS');
  });

  test('CP 04: la resina debe coincidir con la fórmula que mandó el MES', () => {
    const mez = crearNodo(NodoMezanina, { id: 902, nombre: 'MEZ-01' });
    assert.equal(mez.cargarResina({ ot: OT, lote: 'L', skuResina: 'RES02', embudo: 'E1', operador: 'R201' }).codigo, 'OT_NO_ASIGNADA');
    mez.manejarComando(CMD.CARGAR_FORMULA, { ot: OT, skuResina: 'RES02' });
    assert.equal(mez.cargarResina({ ot: OT, lote: 'L', skuResina: 'RES01', embudo: 'E1', operador: 'R201' }).codigo, 'RESINA_INCORRECTA');
    assert.equal(mez.cargarResina({ ot: OT, lote: 'L', skuResina: 'RES02', embudo: 'E1', operador: 'R201' }).codigo, 'PASS');
  });

  test('CP 11–12: SM1 rechaza bolsa ajena, duplicada y caja llena; no cierra incompleta ni sin cinta', () => {
    const sm1 = crearNodo(NodoSM1, { id: 911, nombre: 'SM1-01' });
    assert.equal(sm1.escanearBolsa({ ot: OT, k: 1 }).codigo, 'GATE_PREVIO_NO_PASS'); // sin caja abierta
    sm1.abrirCaja({ caja: 'CJ-1', ot: OT, charolero: 'C11', capacidad: 2 });
    assert.equal(sm1.escanearBolsa({ ot: OT, k: 1 }).codigo, 'PASS');
    assert.equal(sm1.escanearBolsa({ ot: OT, k: 1 }).codigo, 'DUPLICADO');
    assert.equal(sm1.escanearBolsa({ ot: 'OT-2611-099', k: 2 }).codigo, 'BOLSA_OTRA_OT');
    assert.equal(sm1.cerrarCaja({ inspector: 'Q201', encintada: true }).codigo, 'CAJA_INCOMPLETA');
    assert.equal(sm1.escanearBolsa({ ot: OT, k: 2 }).codigo, 'PASS');
    assert.equal(sm1.escanearBolsa({ ot: OT, k: 3 }).codigo, 'CAJA_LLENA');
    assert.equal(sm1.cerrarCaja({ inspector: 'Q201', encintada: false }).codigo, 'CAJA_SIN_ENCINTAR');
    assert.equal(sm1.cerrarCaja({ inspector: 'Q201', encintada: true }).codigo, 'PASS');
    sm1.abrirCaja({ caja: 'CJ-2', ot: OT, charolero: 'C11', capacidad: 2 });
    assert.equal(sm1.escanearBolsa({ ot: OT, k: 1 }).codigo, 'DUPLICADO'); // ya va en una caja cerrada
  });

  test('CP 13–14: PT no acepta otro número de parte, cajas sin ingreso ni tarima incompleta', () => {
    const pt = crearNodo(NodoAlmacenPT, { id: 921, nombre: 'PT-01' });
    assert.equal(pt.ingresarCaja({ caja: 'CJ-1', ot: OT, ubicacion: 'A', almacenista: 'A401' }).codigo, 'PASS');
    assert.equal(pt.ingresarCaja({ caja: 'CJ-1', ot: OT, ubicacion: 'A', almacenista: 'A401' }).codigo, 'DUPLICADO');
    pt.iniciarTarima({ tarima: 'TR-1', orden: 'OE-1', numeroParte: 'TAP-28-PP', esperadas: 1, almacenista: 'A401' });
    assert.equal(pt.agregarCaja({ caja: 'CJ-1', numeroParte: 'ASA-12-PP' }).codigo, 'SKU_NO_COINCIDE');
    assert.equal(pt.agregarCaja({ caja: 'CJ-9', numeroParte: 'TAP-28-PP' }).codigo, 'GATE_PREVIO_NO_PASS');
    assert.equal(pt.cerrarTarima().codigo, 'TARIMA_INCOMPLETA');
    assert.equal(pt.agregarCaja({ caja: 'CJ-1', numeroParte: 'TAP-28-PP' }).codigo, 'PASS');
    assert.equal(pt.agregarCaja({ caja: 'CJ-1', numeroParte: 'TAP-28-PP' }).codigo, 'DUPLICADO');
    assert.equal(pt.cerrarTarima().codigo, 'PASS');
  });

  test('CP 15–16: no se despacha sin las 4 caras confirmadas por la cámara', () => {
    const vis = crearNodo(NodoVision, { id: 931, nombre: 'VIS-01' });
    for (const cara of [1, 2, 3]) vis.escanearCara({ tarima: 'TR-1', cara, camaraOk: true });
    assert.equal(vis.escanearCara({ tarima: 'TR-1', cara: 4, camaraOk: false }).codigo, 'CAMARA_NO_CONFIRMA');
    assert.equal(vis.despachar({ tarima: 'TR-1', puerta: 'P-4' }).codigo, 'TARIMA_INCOMPLETA');
    vis.escanearCara({ tarima: 'TR-1', cara: 4, camaraOk: true });
    assert.equal(vis.despachar({ tarima: 'TR-1', puerta: 'P-4' }).codigo, 'PASS');
  });
});

describe('terminal: búfer, ACK y comandos', () => {
  test('cada evento queda en el búfer hasta que llega su ACK', () => {
    const reloj = relojFalso();
    const canal = canalFalso();
    const n = crearNodo(NodoInyectora, { reloj, canal });
    cargarOT(n);
    const r = n.arrancar({ gafete: 'E1034', ot: OT, qr: n.qr });
    assert.equal(n.cola.length, 1);
    reloj.avanzar(500); // espera aleatoria y transmisión
    const enviada = canal.enviadas.find((e) => decodificar(e.trama, n.clave).tipo === TIPO.EVENTO);
    assert.ok(enviada, 'la terminal transmitió el evento');
    n.recibir(codificar({ tipo: TIPO.ACK, nodo: n.id, seq: 1, seqAck: r.seq, ts: Math.floor(reloj.ahora() / 1000) }, n.clave));
    assert.equal(n.cola.length, 0);
    assert.equal(n.stats.acks, 1);
  });

  test('sin ACK reintenta y, tras varios intentos, se marca sin enlace sin perder el evento', () => {
    const reloj = relojFalso();
    const n = crearNodo(NodoInyectora, { reloj });
    cargarOT(n);
    n.arrancar({ gafete: 'E1034', ot: OT, qr: n.qr });
    reloj.avanzar(60_000);
    assert.equal(n.conEnlace, false);
    assert.equal(n.cola.length, 1);
    assert.ok(n.stats.reintentos >= 4);
  });

  test('un comando repetido (CMD_ACK perdido) se confirma pero no se ejecuta dos veces', () => {
    const reloj = relojFalso();
    const canal = canalFalso();
    const n = crearNodo(NodoInyectora, { reloj, canal });
    const cmd = codificar({ tipo: TIPO.CMD, nodo: n.id, seq: 40, codigo: CMD.CARGAR_OT, datos: { ot: OT, total: 8, pesoNominal: 2400, tolerancia: 40, operadores: ['E1034'] } }, n.clave);
    n.recibir(cmd);
    n.arrancar({ gafete: 'E1034', ot: OT, qr: n.qr });
    n.recibir(cmd); // el gateway reintenta el mismo comando
    assert.equal(n.arrancada, true, 'el reintento no reinició la OT');
    reloj.avanzar(1000);
    const acks = canal.enviadas.map((e) => decodificar(e.trama, n.clave)).filter((m) => m.tipo === TIPO.CMD_ACK);
    assert.equal(acks.length, 2);
    assert.ok(acks.every((a) => a.seqCmd === 40 && a.resultado === FALLA.PASS));
  });

  test('ignora tramas de otro nodo o con firma inválida', () => {
    const n = crearNodo(NodoInyectora);
    const ajeno = crearNodo(NodoInyectora, { id: 108, nombre: 'L1-INY-08' });
    n.recibir(codificar({ tipo: TIPO.CMD, nodo: n.id, seq: 1, codigo: CMD.CARGAR_OT, datos: { ot: OT, total: 8, operadores: [] } }, ajeno.clave));
    assert.equal(n.ot, null);
  });
});
