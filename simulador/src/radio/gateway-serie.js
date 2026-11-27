// Gateway LoRa real por USB, junto a la radio simulada.
//
// Con GATEWAY_SERIE=COM9 (y TERMINAL_REAL=L1-INY-01, el valor por defecto) una inyectora deja de ser simulada:
//   - Lo que el puente le manda (ACK, comandos) sale por el gateway real en vez de la radio simulada.
//   - Lo que el gateway oye pasa al puente como si viniera de la radio: el resto del sistema no cambia.
//   - La inyectora simulada se queda como "gemelo": recibe los mismos comandos (así sabe su OT) y se
//     actualiza con los eventos de la placa real, para que el panel y el resto de la planta la sigan.
//     El gemelo no transmite nada.
//
// El puerto lo abre herramientas/serie.py (pyserial) y aquí se habla con él por stdin/stdout.
//
// Protecciones para la demo:
//   - Si el USB del gateway se desconecta, el puerto se vuelve a abrir solo cada 3 s.
//   - Resincronización: la placa guarda su OT en RAM y la pierde si se reinicia. Con cada latido (ESTADO)
//     se compara lo que dice la placa (OT y última bolsa) contra el gemelo; si no coinciden, se le manda
//     directo su OT con la bolsa en la que iba y el operador, y la placa sigue donde se quedó.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { codificar, decodificar, leerCabecera, claveNodo, TIPO, CMD, CMD_NOMBRE, FALLA, FALLA_NOMBRE, FALLA_TEXTO, TIPO_NOMBRE, hex } from '../protocolo/trama.js';
import { charolaDe } from '../ids.js';

const SCRIPT = fileURLToPath(new URL('../../herramientas/serie.py', import.meta.url));

export class GatewaySerie {
  constructor({ puerto, canal, puente, sim, gemelo, claveRed, reloj, porCharola, python = process.env.PYTHON || 'python' }) {
    Object.assign(this, { puerto, canal, puente, sim, gemelo, reloj, porCharola, python });
    this.id = gemelo.id;
    this.clave = claveNodo(claveRed, gemelo.id);
    this.vistos = new Set(); // seq de eventos ya aplicados al gemelo (la placa reintenta si no le llega el ACK)
    this.stats = { rx: 0, tx: 0, rechazadas: 0, resincronizaciones: 0, reaperturas: 0 };
    this.seqDirecto = 0; // comandos de este módulo (no del MES): seq desde 60000 para no chocar con los del puente
    this.directo = null; // comando directo esperando su CMD_ACK
    this.ultimaResync = 0;
  }

  iniciar() {
    // 1 · El gemelo no transmite: su radio queda muda
    this.gemelo.canal = {
      transmitir() {},
      tieneSenal: () => true,
      registrarNodo() {},
    };
    this.gemelo.enlace = { rssi: 0, snr: 0 };
    this.gemelo.placaReal = true; // el panel no escanea por ella: se desincronizaría de la placa

    // 2 · Lo que el puente manda a esta terminal sale por el gateway real (y el gemelo lo recibe directo)
    const transmitirSimulado = this.canal.transmitir.bind(this.canal);
    this.canal.transmitir = (origen, buf, destino) => {
      if (origen === 'gw' && destino === this.id) {
        this.enviar(buf);
        this.gemelo.recibir(buf);
        return;
      }
      return transmitirSimulado(origen, buf, destino);
    };

    // 3 · Abrir el puerto
    this.abrir();
    console.log(`Gateway real en ${this.puerto}: ${this.gemelo.nombre} es la placa física (nodo ${this.id}).`);
  }

  // Abre el puerto con serie.py; si se cae (USB desconectado), lo reintenta cada 3 s
  abrir() {
    const proceso = spawn(this.python, [SCRIPT, this.puerto], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proceso = proceso;
    proceso.stdin.on('error', () => {}); // escribir a un proceso que ya terminó no debe tumbar el simulador
    proceso.on('error', (e) => console.error(`Gateway real: no se pudo arrancar Python (${e.message})`));
    proceso.stderr.on('data', (d) => console.error(`Gateway real: ${d.toString().trim()}`));
    proceso.on('exit', (code) => {
      if (this.proceso === proceso) this.proceso = null;
      if (this.cerrado) return;
      console.error(`Gateway real: se perdió ${this.puerto} (código ${code}). Reintento en 3 s…`);
      this.stats.reaperturas++;
      setTimeout(() => !this.cerrado && this.abrir(), 3000);
    });
    createInterface({ input: proceso.stdout }).on('line', (l) => this.alLinea(l));
  }

  cerrar() {
    this.cerrado = true;
    this.proceso?.kill();
  }

  enviar(buf) {
    this.stats.tx++;
    if (this.proceso?.stdin.writable) this.proceso.stdin.write(`TX ${buf.toString('hex')}\n`);
    this.aire('bajada', buf, null);
  }

  alLinea(linea) {
    const m = /^RX ([0-9a-f]+) (-?\d+) (-?[\d.]+)$/i.exec(linea.trim());
    if (!m) {
      if (linea.trim()) console.log(`Gateway real: ${linea.trim()}`);
      return;
    }
    const buf = Buffer.from(m[1], 'hex');
    const meta = { rssi: Number(m[2]), snr: Number(m[3]) };
    this.stats.rx++;
    this.aire('subida', buf, meta);
    const cab = leerCabecera(buf);
    if (cab?.nodo === this.id) this.espejo(buf, meta);
    this.puente.recibir(buf, meta); // el puente valida la firma y publica en MQTT, igual que con la radio simulada
  }

  // El gemelo sigue a la placa real: así el panel, la simulación (charolas, cajas) y el MES quedan coherentes
  espejo(buf, meta) {
    const m = decodificar(buf, this.clave);
    if (!m.ok) return;
    const g = this.gemelo;
    g.enlace = { rssi: meta.rssi, snr: meta.snr };
    g.conEnlace = true;

    if (m.tipo === TIPO.ESTADO) {
      // La placa no tiene reloj propio: un ACK vacío (seqAck 0) le da la hora del gateway
      const ack = codificar({ tipo: TIPO.ACK, nodo: this.id, seq: 0, seqAck: 0, ts: Math.floor(this.reloj.ahora() / 1000) }, this.clave);
      setTimeout(() => this.enviar(ack), 60);
      this.revisarSincronia(m);
      return;
    }
    if (m.tipo === TIPO.CMD_ACK && this.directo?.seq === m.seqCmd) {
      clearTimeout(this.directo.timer);
      console.log(`Gateway real: ${g.nombre} confirmó ${this.directo.nombre} (resincronizada).`);
      this.directo = null;
      return;
    }
    if (m.tipo !== TIPO.EVENTO || this.vistos.has(m.seq)) return;
    this.vistos.add(m.seq);
    if (this.vistos.size > 500) this.vistos.delete(this.vistos.values().next().value);

    const d = m.datos;
    const ok = m.resultado === FALLA.PASS;
    const texto = FALLA_TEXTO[FALLA_NOMBRE[m.resultado]] ?? 'Falla';
    g.stats.eventos++;
    g.stats[ok ? 'pass' : 'fail']++;
    g.ultimoEvento = { cp: m.cp, resultado: FALLA_NOMBRE[m.resultado], ts: this.reloj.iso() };

    if (m.cp === 6) {
      if (ok) {
        g.arrancada = true;
        g.bloqueado = false;
        g.operador = d.operador;
        g.mostrar(`OT ${g.ot}`, `Arranque OK · ${d.operador}`, 'verde');
      } else {
        g.bloqueado = true;
        g.mostrar('BLOQUEADA', texto, 'rojo');
      }
    } else if (m.cp === 7) {
      const k = d.bolsa;
      if (ok && d.ot === g.ot) {
        g.bolsas.set(k, { peso: d.peso });
        const ch = charolaDe(k, this.porCharola);
        if (!g.charolas.has(ch)) g.charolas.set(ch, { estado: 'LLENANDO' });
        g.siguiente = k + 1;
        g.mostrar(`OT ${g.ot}`, `Bolsa ${k}/${d.total} · ${d.peso} g`, 'verde');
        this.sim.trasBolsa(g, k); // si se llenó una charola, sigue su camino a SM1
      } else {
        g.mostrar(`Bolsa ${k}/${d.total ?? '?'}`, texto, 'rojo');
      }
    }
  }

  // ¿La placa tiene la misma OT y va en la misma bolsa que su gemelo? Si no, se le manda lo que le falta.
  revisarSincronia(m) {
    const g = this.gemelo;
    const d = m.datos ?? {};
    if (m.bufer > 0 || this.directo) return; // hay eventos en camino o ya se está corrigiendo: esperar al siguiente latido
    const otPlaca = d.ot ?? null;
    const otSim = g.ot ?? null;
    const bolsaPlaca = otPlaca ? (d.bolsa ?? 0) : null;
    const bolsaSim = otSim ? g.siguiente - 1 : null;
    if (otPlaca === otSim && bolsaPlaca === bolsaSim) return;
    // La misma diferencia no se corrige dos veces en 8 s (un latido viejo que llega tarde); una nueva, al momento
    const firma = `${otPlaca}|${bolsaPlaca}|${otSim}|${bolsaSim}`;
    if (firma === this.ultimaFirma && Date.now() - this.ultimaResync < 8000) return;
    this.ultimaFirma = firma;
    this.ultimaResync = Date.now();
    this.stats.resincronizaciones++;

    if (!otSim) {
      console.log(`Gateway real: ${g.nombre} tiene la OT ${otPlaca}, que ya no está activa. Se cierra en la placa.`);
      return this.comandoDirecto(CMD.FIN_OT, { ot: otPlaca });
    }
    const datos = { ot: g.ot, skuProducto: g.cfgOT.sku, total: g.cfgOT.total, pesoNominal: g.cfgOT.nominal, tolerancia: g.cfgOT.tol, operadores: g.cfgOT.operadores, bolsa: g.siguiente - 1 };
    if (g.arrancada && !g.bloqueado && g.operador) {
      datos.operador = g.operador; // la placa sigue produciendo sin repetir el arranque
    } else {
      // Antes del arranque (o bloqueada): la placa reiniciada vuelve a pedir gafete, OT y QR; el gemelo igual
      g.arrancada = false;
      g.bloqueado = false;
      g.lecturas = {};
    }
    console.log(`Gateway real: ${g.nombre} dice OT ${otPlaca ?? 'ninguna'} bolsa ${bolsaPlaca ?? '-'}, el MES dice ${otSim} bolsa ${bolsaSim}. Se le devuelve su OT.`);
    this.comandoDirecto(CMD.CARGAR_OT, datos);
  }

  // Comando directo a la placa (sin pasar por el MES), con hasta 5 intentos
  comandoDirecto(codigo, datos) {
    const seq = 60000 + (this.seqDirecto++ % 5000);
    const trama = codificar({ tipo: TIPO.CMD, nodo: this.id, seq, codigo, datos }, this.clave);
    const p = { seq, nombre: CMD_NOMBRE[codigo], intentos: 0 };
    const intentar = () => {
      if (this.directo !== p) return;
      if (p.intentos++ >= 5) {
        console.error(`Gateway real: ${this.gemelo.nombre} no confirmó ${p.nombre} después de 5 intentos.`);
        this.directo = null;
        return;
      }
      this.enviar(trama);
      p.timer = setTimeout(intentar, 3000);
    };
    this.directo = p;
    intentar();
  }

  // Para la vista "aire" del panel
  aire(dir, buf, meta) {
    const cab = leerCabecera(buf);
    this.canal.emit('trama', {
      ts: this.reloj.iso(),
      dir,
      nodo: this.gemelo.nombre,
      canal: this.gemelo.canalLoRa,
      tipo: TIPO_NOMBRE[cab?.tipo] ?? '?',
      seq: cab?.seq,
      seqAck: cab?.tipo === TIPO.ACK && buf.length >= 11 ? buf.readUInt16BE(5) : undefined,
      bytes: buf.length,
      airtimeMs: 0,
      hex: hex(buf),
      estado: 'ok',
      rssi: meta?.rssi,
      snr: meta?.snr,
      real: true,
    });
  }
}
