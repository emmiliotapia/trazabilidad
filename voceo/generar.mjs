// Genera los MP3 de voceo con ElevenLabs a partir de catalogo.json.
//
//   node generar.mjs --seco              lista los avisos y cuenta caracteres, sin llamar a la API
//   node generar.mjs --voces             lista las voces de la cuenta (para elegir VOZ_ID)
//   node generar.mjs --muestra           solo una muestra variada (~50): 4 inyectoras de las 3 líneas y 2 estaciones por rol, más los generales
//   node generar.mjs --solo 5            genera solo los primeros 5 (para probar la voz)
//   node generar.mjs                     genera todo lo que falte en salida/
//   node generar.mjs --forzar            vuelve a generar aunque el archivo exista
//
// Variables (en el entorno o en voceo/.env):
//   ELEVENLABS_API_KEY  obligatoria
//   VOZ_ID              voz a usar (por defecto Ana María, mexicana: m7yTemJqdIqrcNleANfX)
//   MODELO              por defecto eleven_multilingual_v2
//   FORMATO             por defecto mp3_44100_128

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirAvisos } from './avisos.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.join(DIR, 'salida');
const API = 'https://api.elevenlabs.io/v1';

cargarEnv(path.join(DIR, '.env'));
const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const valor = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const KEY = process.env.ELEVENLABS_API_KEY;
const VOZ = process.env.VOZ_ID || 'm7yTemJqdIqrcNleANfX'; // Ana María (mexicana, Voice Library)
const MODELO = process.env.MODELO || 'eleven_multilingual_v2';
const FORMATO = process.env.FORMATO || 'mp3_44100_128';

const catalogo = JSON.parse(fs.readFileSync(path.join(DIR, 'catalogo.json'), 'utf8'));
const todos = construirAvisos(catalogo);
const MUESTRA = ['L1-INY-01', 'L1-INY-21', 'L2-INY-07', 'L3-INY-09', 'MEZ-01', 'SM1-02', 'PT-01', 'EMB-01'];
const avisos = tiene('--muestra')
  ? todos.filter((a) => a.tipo === 'general' || MUESTRA.includes(a.destino)).filter(maxPorRol(6))
  : todos;

if (tiene('--seco')) {
  for (const a of avisos) console.log(`${a.archivo.padEnd(42)} ${a.texto}`);
  const chars = avisos.reduce((s, a) => s + a.texto.length, 0);
  console.log(`\n${avisos.length} avisos, ${chars} caracteres.`);
  process.exit(0);
}

if (!KEY) {
  console.error('Falta ELEVENLABS_API_KEY (ponla en voceo/.env o en el entorno).');
  process.exit(1);
}

if (tiene('--voces')) {
  const r = await fetch(`${API}/voices`, { headers: { 'xi-api-key': KEY } });
  if (!r.ok) throw new Error(`voices ${r.status}: ${await r.text()}`);
  const { voices } = await r.json();
  for (const v of voices) {
    const l = v.labels || {};
    console.log(`${v.voice_id}  ${v.name.padEnd(28)} ${[l.gender, l.accent, l.language, l.use_case].filter(Boolean).join(', ')}`);
  }
  process.exit(0);
}

fs.mkdirSync(SALIDA, { recursive: true });
const limite = valor('--solo') ? Number(valor('--solo')) : Infinity;
let hechos = 0, saltados = 0;
for (const a of avisos.slice(0, limite)) {
  const destino = path.join(SALIDA, a.archivo);
  if (!tiene('--forzar') && fs.existsSync(destino)) { saltados++; continue; }
  const audio = await sintetizar(a.texto);
  fs.writeFileSync(destino, audio);
  hechos++;
  console.log(`ok  ${a.archivo}  "${a.texto}"`);
}
escribirManifiesto(avisos);
console.log(`\nGenerados ${hechos}, ya existían ${saltados}. Carpeta: ${SALIDA}`);

// ---------------------------------------------------------------------------

async function sintetizar(texto, intento = 1) {
  const r = await fetch(`${API}/text-to-speech/${VOZ}?output_format=${FORMATO}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: texto,
      model_id: MODELO,
      voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.95 },
    }),
  });
  if (r.status === 429 && intento < 5) {
    await new Promise((ok) => setTimeout(ok, 2000 * intento));
    return sintetizar(texto, intento + 1);
  }
  if (!r.ok) throw new Error(`TTS ${r.status} en "${texto}": ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

function escribirManifiesto(lista) {
  fs.mkdirSync(SALIDA, { recursive: true });
  const m = { generado: new Date().toISOString(), voz: VOZ, modelo: MODELO, formato: FORMATO, avisos: lista };
  fs.writeFileSync(path.join(SALIDA, 'manifiesto.json'), JSON.stringify(m, null, 2));
}

function cargarEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const linea of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Deja pasar a lo más n avisos de cada rol (los generales siempre pasan).
function maxPorRol(n) {
  const cuenta = {};
  return (a) => !a.rol || (cuenta[a.rol] = (cuenta[a.rol] || 0) + 1) <= n;
}
