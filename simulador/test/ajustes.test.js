// Configuración del panel: lo inválido se descarta y lo válido se guarda y se avisa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Ajustes, PREDETERMINADOS } from '../src/ajustes.js';
import { carpetaTemporal } from './ayuda.js';

const ROLES = ['supervisor', 'calidad', 'mantenimiento'];
const nuevo = (ruta = join(carpetaTemporal(), 'ajustes.json')) => new Ajustes(ruta, { roles: ROLES });

test('sin archivo arranca con los valores de fábrica', () => {
  assert.deepEqual(nuevo().get(), PREDETERMINADOS);
});

test('guarda colores y nombres válidos, en minúsculas, y avisa del cambio', () => {
  const a = nuevo();
  let aviso = null;
  a.on('cambio', (v) => (aviso = v));
  const v = a.guardar({ estados: { rojo: { color: '#FF00AA', nombre: 'Paro' } }, barra: '#123456' });
  assert.deepEqual(v.estados.rojo, { color: '#ff00aa', nombre: 'Paro' });
  assert.equal(v.barra, '#123456');
  assert.equal(aviso, v);
  assert.deepEqual(JSON.parse(readFileSync(a.ruta, 'utf8')).estados.rojo.color, '#ff00aa');
  assert.equal(existsSync(`${a.ruta}.tmp`), false, 'escritura atómica: no deja el temporal');
});

test('descarta colores mal escritos, textos vacíos, números fuera de rango y roles que no existen', () => {
  const v = nuevo().guardar({
    estados: { verde: { color: 'verde', nombre: '   ' }, ambar: { color: '#12345' } },
    voceo: { silencioMin: 999, repetir: 0, maxEscalamientos: 'x', activo: 'si', reglas: { DEFECTO_CRITICO: 'intruso', DUPLICADO: '', INVENTADO: 'calidad' } },
  });
  assert.deepEqual(v.estados.verde, PREDETERMINADOS.estados.verde);
  assert.equal(v.estados.ambar.color, PREDETERMINADOS.estados.ambar.color);
  assert.equal(v.voceo.silencioMin, 60);
  assert.equal(v.voceo.repetir, 1);
  assert.equal(v.voceo.maxEscalamientos, PREDETERMINADOS.voceo.maxEscalamientos);
  assert.equal(v.voceo.activo, true);
  assert.equal(v.voceo.reglas.DEFECTO_CRITICO, 'calidad');
  assert.equal(v.voceo.reglas.DUPLICADO, '', '"" es válido: no vocear');
  assert.equal('INVENTADO' in v.voceo.reglas, false);
});

test('los textos largos se recortan', () => {
  const v = nuevo().guardar({ planta: { nombre: 'x'.repeat(500) } });
  assert.equal(v.planta.nombre.length, 60);
});

test('un archivo dañado no impide arrancar: se usan los de fábrica', () => {
  const ruta = join(carpetaTemporal(), 'ajustes.json');
  writeFileSync(ruta, '{ esto no es json');
  const original = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(nuevo(ruta).get(), PREDETERMINADOS);
  } finally {
    console.warn = original;
  }
});

test('lo guardado se lee al volver a arrancar, y restablecer vuelve a fábrica', () => {
  const ruta = join(carpetaTemporal(), 'ajustes.json');
  nuevo(ruta).guardar({ planta: { nombre: 'Planta Norte' } });
  const otra = nuevo(ruta);
  assert.equal(otra.get().planta.nombre, 'Planta Norte');
  assert.deepEqual(otra.restablecer(), PREDETERMINADOS);
});
