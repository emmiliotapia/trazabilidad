// Catálogo de voceo (voceo/avisos.mjs): textos y nombres de archivo que comparten el generador de MP3 y el MES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerCatalogo, construirAvisos, numero } from '../../voceo/avisos.mjs';

const catalogo = leerCatalogo();
const avisos = construirAvisos(catalogo);

test('los números se dicen con letra (la voz no debe leer "cero uno")', () => {
  assert.deepEqual([1, 7, 16, 21, 22, 30, 31, 45].map(numero), ['uno', 'siete', 'dieciséis', 'veintiuno', 'veintidós', 'treinta', 'treinta y uno', 'cuarenta y cinco']);
});

test('hay un aviso por cada rol y destino permitido: 412 con las 3 líneas (22 + 20 + 9)', () => {
  assert.deepEqual(catalogo.lineas, [22, 20, 9]);
  assert.equal(avisos.length, 412);
  assert.equal(avisos.filter((a) => a.rol === 'supervisor').length, 51 + catalogo.estaciones.length);
  assert.equal(avisos.filter((a) => a.rol === 'montacargas' && a.destino.includes('INY')).length, 0, 'el montacargas no va a las inyectoras');
});

test('cada archivo es único y su nombre es seguro para servirlo por HTTP', () => {
  const archivos = avisos.map((a) => a.archivo);
  assert.equal(new Set(archivos).size, archivos.length);
  assert.ok(archivos.every((f) => /^[\w-]+\.mp3$/.test(f)));
  assert.ok(avisos.every((a) => a.archivo === `${a.clave}.mp3`));
});

test('el aviso siempre dice la línea, porque el número de máquina se repite en las tres', () => {
  const a = avisos.find((x) => x.clave === 'mantenimiento__L3-INY-09');
  assert.equal(a.texto, 'Mantenimiento, favor de acudir a línea tres, inyectora nueve.');
  assert.ok(avisos.filter((x) => x.destino?.includes('-INY-')).every((x) => /línea (uno|dos|tres), inyectora/.test(x.texto)));
});

test('las estaciones llevan su preposición correcta', () => {
  const t = (c) => avisos.find((x) => x.clave === c).texto;
  assert.equal(t('calidad__MP-01'), 'Calidad, favor de acudir al almacén de materia prima.');
  assert.equal(t('supervisor__MEZ-01'), 'Supervisor de producción, favor de acudir a la mezanina.');
});

test('un destino que no existe en el catálogo es un error, no un aviso mudo', () => {
  const malo = structuredClone(catalogo);
  malo.roles[0].destinos = ['XX-99'];
  assert.throws(() => construirAvisos(malo), /destino desconocido/);
});
