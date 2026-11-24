// Arma la lista de avisos (texto y nombre de archivo) a partir de catalogo.json.
// La usan generar.mjs (para crear los MP3) y el MES del simulador (para saber qué texto va con cada archivo).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR_VOCEO = path.dirname(fileURLToPath(import.meta.url));

export function leerCatalogo(ruta = path.join(DIR_VOCEO, 'catalogo.json')) {
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

export function construirAvisos(c) {
  const inyectoras = [];
  c.lineas.forEach((n, i) => {
    const linea = i + 1;
    for (let m = 1; m <= n; m++) {
      inyectoras.push({
        id: `L${linea}-INY-${String(m).padStart(2, '0')}`,
        texto: `a línea ${numero(linea)}, inyectora ${numero(m)}`,
      });
    }
  });
  const porId = new Map(c.estaciones.map((e) => [e.id, e]));
  const grupos = { inyectoras, estaciones: c.estaciones };

  const lista = [];
  for (const rol of c.roles) {
    const destinos = rol.destinos.flatMap((d) => {
      if (grupos[d]) return grupos[d];
      if (porId.has(d)) return [porId.get(d)];
      throw new Error(`destino desconocido: ${d}`);
    });
    for (const d of destinos) {
      const texto = c.plantilla_llamado.replace('{rol}', rol.texto).replace('{destino}', d.texto);
      lista.push({ clave: `${rol.id}__${d.id}`, tipo: 'llamado', rol: rol.id, destino: d.id, texto, archivo: `${rol.id}__${d.id}.mp3` });
    }
  }
  for (const g of c.generales) {
    lista.push({ clave: `general__${g.id}`, tipo: 'general', rol: null, destino: null, texto: g.texto, archivo: `general__${g.id}.mp3` });
  }
  return lista;
}

export function numero(n) {
  const u = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
    'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
    'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  if (n < 30) return u[n];
  const d = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  return n % 10 ? `${d[Math.floor(n / 10)]} y ${u[n % 10]}` : d[n / 10];
}
