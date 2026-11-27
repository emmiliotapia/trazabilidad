// Terminal de inyectora (CP 06 arranque y CP 07 bolsas). Versión C++ de NodoInyectora
// (simulador/src/nodo/estaciones.js) y de Nodo (simulador/src/nodo/nodo.js):
//   - valida el escaneo en la placa y responde al instante (PASS/FAIL en pantalla)
//   - numera cada evento (seq), lo manda por LoRa y espera el ACK del gateway
//   - sin ACK reintenta; sin enlace guarda los eventos en una cola y los manda al volver la señal
//   - atiende comandos del MES: cargar OT, desbloquear, fin de OT (contesta CMD_ACK)
//
// Entrada de códigos: por el USB (lo que se escriba o escanee en el monitor serie + Enter).
// Báscula: no hay en el demo; se usa el peso nominal de la OT. Escanear "PESO-1300" fija el peso de la siguiente bolsa.
// Limitación del demo: la cola vive en RAM; si la placa se reinicia, se pierde lo que no se había enviado.
#include <Arduino.h>
#include <placa.h>
#include <trama.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>

// Bluetooth (BLE) para el celular como escáner. Usa el perfil "UART por BLE" (Nordic UART):
//   el celular escribe códigos (texto + Enter) en RX, y la terminal responde por TX con su resultado.
#define BLE_SERVICIO "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define BLE_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

using namespace trama;

// ───── identidad de esta terminal (en planta vendrá de un QR de configuración) ─────
const uint16_t NODO_ID = 101;
const char *NOMBRE = "L1-INY-01";
const char *QR_MAQUINA = "QR-L1-INY-01";
const char *CLAVE_RED = "aseti-demo-clave-2026"; // CONFIG.claveRed del simulador

// ───── comportamiento (igual que CONFIG.nodo del simulador) ─────
const uint32_t ESPERA_ACK_MS = 2500;
const uint8_t MAX_INTENTOS = 4;
const uint32_t REINTENTO_LARGO_MS = 20000;
const uint32_t LATIDO_MS = 60000;

uint8_t clave[LARGO_CLAVE];
bool radioOk = false;

// ───── cola de eventos pendientes de ACK ─────
struct Pendiente {
  uint8_t datos[MAX_TRAMA];
  uint8_t largo;
  uint16_t seq;
  uint8_t intentos;
};
const int CAPACIDAD = 40;
Pendiente cola[CAPACIDAD];
int cabeza = 0, cuantos = 0;
uint16_t seq = 0;
bool enVuelo = false;
uint32_t envioMs = 0, proximoIntentoMs = 0;
bool conEnlace = true;
int32_t offsetReloj = 0;
int ultimoRssi = 0;

// ───── estado de la OT (lo carga el MES por comando) ─────
String ot, operadores, operador, lecGafete, lecOT;
uint16_t total = 0, nominal = 0, tolerancia = 0, siguiente = 1;
bool arrancada = false, bloqueado = false;
int pesoManual = -1;
// Comandos ya ejecutados: número + huella del contenido. Si el MES o el puente se reinician vuelven a numerar
// desde 1; con solo el número, un comando nuevo se tomaría por repetido y se ignoraría.
uint32_t cmdsVistos[16];
int cmdsIdx = 0, cmdsCuantos = 0;

// ───── pantalla ─────
enum Color { GRIS, AMBAR, VERDE, ROJO };
String linea1, linea2;
Color color = GRIS;
bool redibujar = true;
String entrada;

// ───── Bluetooth: lo que llega del celular se guarda aquí y el loop lo procesa ─────
// (el stack BLE corre en otro núcleo del ESP32, por eso se protege con portMUX)
portMUX_TYPE muxBLE = portMUX_INITIALIZER_UNLOCKED;
String colaBLE;
BLECharacteristic *caracTX = nullptr;
bool bleConectado = false;

class EscrituraBLE : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String v = c->getValue(); // en esta versión de la librería devuelve String de Arduino
    portENTER_CRITICAL(&muxBLE);
    colaBLE += v;
    portEXIT_CRITICAL(&muxBLE);
  }
};

class ConexionBLE : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { bleConectado = true; }
  void onDisconnect(BLEServer *s) override {
    bleConectado = false;
    s->getAdvertising()->start(); // vuelve a anunciarse para que el celular reconecte
  }
};

// Manda el resultado al celular (si está conectado). Máximo 20 bytes por notificación en el perfil por defecto.
void notificarBLE(const String &texto) {
  if (!bleConectado || !caracTX) return;
  String corto = texto.substring(0, 180);
  caracTX->setValue((uint8_t *)corto.c_str(), corto.length());
  caracTX->notify();
}

void iniciarBLE() {
  BLEDevice::init(String("ASETI-") + NOMBRE);
  BLEServer *servidor = BLEDevice::createServer();
  servidor->setCallbacks(new ConexionBLE());
  BLEService *servicio = servidor->createService(BLE_SERVICIO);
  BLECharacteristic *rx = servicio->createCharacteristic(BLE_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new EscrituraBLE());
  caracTX = servicio->createCharacteristic(BLE_TX, BLECharacteristic::PROPERTY_NOTIFY);
  caracTX->addDescriptor(new BLE2902());
  servicio->start();
  BLEAdvertising *anuncio = BLEDevice::getAdvertising();
  anuncio->addServiceUUID(BLE_SERVICIO);
  anuncio->setScanResponse(true);
  anuncio->start();
}

// El número de secuencia sobrevive a los reinicios: el MES descarta repetidos por (nodo, seq), así que si la
// placa volviera a contar desde 1 sus eventos nuevos se tomarían por copias y se perderían. Se reservan bloques
// de 256 en la memoria permanente (NVS): una escritura cada 256 eventos, y al arrancar se salta al bloque siguiente.
Preferences memoria;
uint16_t limiteSeq = 0;
const uint16_t BLOQUE_SEQ = 256;

void reservarSeq() {
  limiteSeq = (uint16_t)(seq + BLOQUE_SEQ);
  memoria.putUShort("seq", limiteSeq);
}

void iniciarSeq() {
  memoria.begin("terminal", false);
  // Arranca donde terminaba el último bloque reservado: nunca repite. Placa nueva (memoria vacía): un bloque al azar,
  // para no chocar con los números que el MES ya guardó de la placa anterior con el mismo nodo.
  seq = memoria.isKey("seq") ? memoria.getUShort("seq") : (uint16_t)(esp_random() & 0xFF00);
  reservarSeq();
}

uint16_t siguienteSeq() {
  seq = (uint16_t)(seq + 1);
  if (seq == 0) seq = 1;             // 0 lo usa el ACK de hora del gateway
  if (seq == limiteSeq) reservarSeq();
  return seq;
}
uint32_t hora() { return (uint32_t)((int32_t)(millis() / 1000) + offsetReloj); }

const char *textoFalla(uint8_t c) {
  switch (c) {
    case PASS: return "Correcto";
    case GATE_PREVIO_NO_PASS: return "El paso anterior no esta en PASS";
    case OT_NO_ASIGNADA: return "La OT no es de esta maquina";
    case OPERADOR_NO_HABILITADO: return "Operador no habilitado para esta OT";
    case QR_MAQUINA_INCORRECTO: return "El QR no es de esta maquina";
    case NODO_BLOQUEADO: return "Terminal bloqueada";
    case PESO_FUERA_TOLERANCIA: return "Peso fuera de tolerancia";
    case SECUENCIA_ROTA: return "Salto en la secuencia";
    default: return "Falla";
  }
}

void mostrar(const String &l1, const String &l2, Color c) {
  linea1 = l1;
  linea2 = l2;
  color = c;
  redibujar = true;
  Serial.printf("[%s] %s | %s\n", c == VERDE ? "PASS" : c == ROJO ? "FAIL" : c == AMBAR ? "...." : "    ", l1.c_str(), l2.c_str());
  notificarBLE(String(c == VERDE ? "PASS" : c == ROJO ? "FAIL" : "INFO") + "|" + l1 + "|" + l2);
}

void dibujar() {
  auto &p = placa::pantalla();
  p.clear();
  p.normalDisplay();
  p.setFont(ArialMT_Plain_10);
  p.setTextAlignment(TEXT_ALIGN_LEFT);
  p.drawString(0, 0, NOMBRE);
  p.setTextAlignment(TEXT_ALIGN_RIGHT);
  String senal = !radioOk ? "SIN RADIO" : conEnlace ? (ultimoRssi ? String(ultimoRssi) + "dBm" : "LoRa") : "SIN SENAL";
  if (cuantos) senal = "cola " + String(cuantos) + "  " + senal;
  p.drawString(128, 0, senal);
  p.setTextAlignment(TEXT_ALIGN_LEFT);
  p.drawHorizontalLine(0, 12, 128);
  if (color == VERDE || color == ROJO) {
    p.setFont(ArialMT_Plain_16);
    p.drawString(0, 14, color == VERDE ? "PASS" : "FAIL");
    p.setFont(ArialMT_Plain_10);
    p.drawString(48, 18, linea1);
  } else {
    p.drawString(0, 18, linea1);
  }
  p.drawStringMaxWidth(0, 34, 128, linea2);
  if (color == ROJO) p.invertDisplay(); // en rojo toda la pantalla se invierte: se ve de lejos
  p.display();
}

// ───────────── envío con ACK ─────────────
void encolar(Escritor &t, uint16_t s) {
  size_t n = t.firmar(clave);
  if (!n) return;
  if (cuantos == CAPACIDAD) {
    Serial.println("Cola llena: evento descartado");
    return;
  }
  Pendiente &p = cola[(cabeza + cuantos) % CAPACIDAD];
  memcpy(p.datos, t.datos(), n);
  p.largo = n;
  p.seq = s;
  p.intentos = 0;
  cuantos++;
  if (!enVuelo && cuantos == 1) proximoIntentoMs = millis() + random(20, 400); // espera al azar para no chocar
  redibujar = true;
}

void bombear() {
  if (!radioOk) return;
  if (enVuelo && millis() - envioMs > ESPERA_ACK_MS) {
    enVuelo = false;
    Pendiente &p = cola[cabeza];
    if (p.intentos >= MAX_INTENTOS) {
      conEnlace = false;
      p.intentos = 0;
      proximoIntentoMs = millis() + REINTENTO_LARGO_MS;
      redibujar = true;
    } else {
      proximoIntentoMs = millis() + random(300, 1500) * p.intentos;
    }
  }
  if (!enVuelo && cuantos > 0 && (int32_t)(millis() - proximoIntentoMs) >= 0) {
    Pendiente &p = cola[cabeza];
    p.intentos++;
    placa::transmitir(p.datos, p.largo);
    enVuelo = true;
    envioMs = millis();
  }
}

// Arma un evento con su cabecera y su cuerpo fijo; el que llama agrega los campos y llama a encolar()
Escritor nuevoEvento(uint8_t cp, uint8_t resultado, uint16_t &s) {
  s = siguienteSeq();
  Escritor t(EVENTO, NODO_ID, s);
  t.u8(cp);
  t.u8(resultado);
  t.u32(hora());
  return t;
}

void latido() {
  Escritor t(ESTADO, NODO_ID, siguienteSeq());
  t.u32(hora());
  t.u16(cuantos);
  t.u8(bloqueado ? 1 : 0);
  if (ot.length()) {
    t.texto(OT, ot.c_str());
    t.campoU16(BOLSA, siguiente - 1);
    t.campoU16(TOTAL, total);
  }
  if (t.firmar(clave)) placa::transmitir(t.datos(), t.largo());
}

// ───────────── lógica del gate (igual que NodoInyectora) ─────────────
void limpiarOT() {
  ot = operadores = operador = lecGafete = lecOT = "";
  total = nominal = tolerancia = 0;
  siguiente = 1;
  arrancada = bloqueado = false;
  pesoManual = -1;
}

bool operadorHabilitado(const String &g) {
  return ("," + operadores + ",").indexOf("," + g + ",") >= 0;
}

void arrancar(const String &gafete, const String &otEscaneada, const String &qr) {
  uint8_t c = PASS;
  if (!ot.length()) c = OT_NO_ASIGNADA;
  else if (bloqueado) c = NODO_BLOQUEADO;
  else if (!operadorHabilitado(gafete)) c = OPERADOR_NO_HABILITADO;
  else if (otEscaneada != ot) c = OT_NO_ASIGNADA;
  else if (qr != QR_MAQUINA) c = QR_MAQUINA_INCORRECTO;

  if (c == PASS) {
    arrancada = true;
    operador = gafete;
    mostrar("Arranque OK - " + gafete, "Ahora escanee la etiqueta de la bolsa 1", VERDE);
  } else {
    bloqueado = true;
    mostrar("BLOQUEADA", textoFalla(c), ROJO);
  }
  uint16_t s;
  Escritor t = nuevoEvento(6, c, s);
  t.texto(OT, otEscaneada.c_str());
  t.texto(OPERADOR, gafete.c_str());
  t.texto(MAQUINA, qr.c_str());
  encolar(t, s);
}

void registrarBolsa(uint16_t k, uint16_t peso) {
  uint8_t c = PASS;
  if (!arrancada || bloqueado) c = GATE_PREVIO_NO_PASS;
  else if (k != siguiente) c = SECUENCIA_ROTA;
  else if (abs((int)peso - (int)nominal) > tolerancia) c = PESO_FUERA_TOLERANCIA;

  if (c == PASS) {
    siguiente++;
    pesoManual = -1;
    mostrar("Bolsa " + String(k) + "/" + String(total) + " OK - " + String(peso) + " g",
            siguiente > total ? String("OT completa: ultima bolsa registrada") : "Sigue la bolsa " + String(siguiente), VERDE);
  } else {
    String detalle = textoFalla(c);
    if (c == PESO_FUERA_TOLERANCIA) detalle += " (" + String(peso) + " g)";
    if (c == SECUENCIA_ROTA) detalle += ": tocaba la " + String(siguiente);
    mostrar("Bolsa " + String(k) + "/" + String(total), detalle, ROJO);
  }
  uint16_t s;
  Escritor t = nuevoEvento(7, c, s);
  t.texto(OT, ot.c_str());
  t.campoU16(BOLSA, k);
  t.campoU16(TOTAL, total);
  t.campoU16(PESO, peso);
  t.texto(OPERADOR, operador.c_str());
  encolar(t, s);
}

bool soloDigitos(const String &s, int desde, int hasta) {
  if (hasta <= desde) return false;
  for (int i = desde; i < hasta; i++)
    if (!isDigit(s[i])) return false;
  return true;
}

// "OT-2611-042" → true
bool esOT(const String &c) {
  if (!c.startsWith("OT-")) return false;
  int guion = c.indexOf('-', 3);
  return guion > 3 && soloDigitos(c, 3, guion) && soloDigitos(c, guion + 1, c.length());
}

void aviso(const String &l2, Color c = AMBAR) { mostrar(ot.length() ? "OT " + ot : String(NOMBRE), l2, c); }

void escanear(String c) {
  c.trim();
  c.toUpperCase();
  if (!c.length()) return;
  if (!ot.length()) return aviso("Sin OT cargada: espere la liberacion (CP 05)", GRIS);

  if (c.startsWith("PESO-") && soloDigitos(c, 5, c.length())) {
    pesoManual = c.substring(5).toInt();
    return aviso("Bascula: " + String(pesoManual) + " g. Escanee la etiqueta");
  }

  // Etiqueta de bolsa: OT-xxxx-xxx-Bnnn
  int b = c.lastIndexOf("-B");
  if (b > 0 && esOT(c.substring(0, b)) && soloDigitos(c, b + 2, c.length())) {
    String otBolsa = c.substring(0, b);
    uint16_t k = c.substring(b + 2).toInt();
    if (!arrancada) return aviso("Primero el arranque: gafete, OT y QR");
    if (otBolsa != ot) {
      mostrar("Etiqueta " + c, "La etiqueta es de otra OT", ROJO);
      uint16_t s;
      Escritor t = nuevoEvento(7, OT_NO_ASIGNADA, s);
      t.texto(OT, otBolsa.c_str());
      t.campoU16(BOLSA, k);
      t.texto(OPERADOR, operador.c_str());
      encolar(t, s);
      return;
    }
    return registrarBolsa(k, pesoManual >= 0 ? pesoManual : nominal);
  }

  if (arrancada) return aviso("En produccion: escanee etiquetas de bolsa");
  if (bloqueado) return aviso("Terminal bloqueada: requiere supervisor", ROJO);

  if (c[0] == 'E' && soloDigitos(c, 1, c.length())) {
    lecGafete = c;
    lecOT = "";
    return aviso("Gafete " + c + " OK. Paso 2: escanee la OT");
  }
  if (esOT(c)) {
    if (!lecGafete.length()) return aviso("Primero escanee su gafete");
    lecOT = c;
    return aviso("OT OK. Paso 3: escanee el QR de la maquina");
  }
  if (c.startsWith("QR-")) {
    if (!lecGafete.length() || !lecOT.length()) return aviso("Orden: gafete, OT y despues QR");
    String g = lecGafete, o = lecOT;
    lecGafete = lecOT = "";
    return arrancar(g, o, c);
  }
  aviso("Codigo no reconocido: " + c, ROJO);
}

// ───────────── recepción (bajada) ─────────────
String textoCampo(const uint8_t *v, uint8_t n) {
  String s;
  for (int i = 0; i < n; i++) s += (char)v[i];
  return s;
}

void manejarComando(uint8_t codigo, const uint8_t *p, const uint8_t *fin) {
  if (codigo == CARGAR_OT) {
    limpiarOT();
    uint8_t tag, n;
    const uint8_t *v;
    while (siguienteCampo(p, fin, tag, v, n)) {
      if (tag == OT) ot = textoCampo(v, n);
      else if (tag == TOTAL && n == 2) total = leerU16(v);
      else if (tag == PESO_NOMINAL && n == 2) nominal = leerU16(v);
      else if (tag == TOLERANCIA && n == 2) tolerancia = leerU16(v);
      else if (tag == OPERADORES) operadores = textoCampo(v, n);
      // Resincronización tras un reinicio: el gateway manda en qué bolsa iba y quién arrancó
      else if (tag == BOLSA && n == 2) siguiente = leerU16(v) + 1;
      else if (tag == OPERADOR) operador = textoCampo(v, n);
    }
    if (operador.length()) {
      arrancada = true;
      mostrar("OT " + ot, "Reanudada: sigue la bolsa " + String(siguiente), VERDE);
    } else {
      mostrar("OT " + ot, "Paso 1: escanee su gafete", AMBAR);
    }
  } else if (codigo == DESBLOQUEAR) {
    bloqueado = false;
    lecGafete = lecOT = "";
    mostrar("OT " + (ot.length() ? ot : String("-")), "Desbloqueada por supervisor", AMBAR);
  } else if (codigo == FIN_OT) {
    limpiarOT();
    mostrar(NOMBRE, "OT cerrada. Sin OT", GRIS);
  }
}

void recibir() {
  int n = LoRa.parsePacket();
  if (n <= 0) return;
  uint8_t buf[MAX_TRAMA];
  int i = 0;
  while (LoRa.available() && i < (int)sizeof buf) buf[i++] = (uint8_t)LoRa.read();
  Leida m = leer(buf, i, clave);
  if (!m.ok || m.nodo != NODO_ID) return; // ajena o con firma inválida
  ultimoRssi = LoRa.packetRssi();
  const uint8_t *c = m.cuerpo, *fin = m.cuerpo + m.largoCuerpo;

  if (m.tipo == ACK && m.largoCuerpo >= 6) {
    uint16_t seqAck = leerU16(c);
    offsetReloj = (int32_t)leerU32(c + 2) - (int32_t)(millis() / 1000); // la hora la da el gateway
    if (enVuelo && cuantos && cola[cabeza].seq == seqAck) {
      cabeza = (cabeza + 1) % CAPACIDAD;
      cuantos--;
      enVuelo = false;
      proximoIntentoMs = millis() + random(50, 250);
    }
    conEnlace = true;
    redibujar = true;
    return;
  }

  if (m.tipo == CMD && m.largoCuerpo >= 1) {
    bool repetido = false; // si el CMD_ACK se perdió y el gateway reintenta, no se ejecuta dos veces
    uint32_t huella = 2166136261u; // FNV-1a del cuerpo, mezclado con el número
    for (int j = 0; j < (int)m.largoCuerpo; j++) huella = (huella ^ m.cuerpo[j]) * 16777619u;
    huella ^= (uint32_t)m.seq << 16;
    for (int j = 0; j < cmdsCuantos; j++)
      if (cmdsVistos[j] == huella) repetido = true;
    if (!repetido) {
      cmdsVistos[cmdsIdx] = huella;
      cmdsIdx = (cmdsIdx + 1) % 16;
      if (cmdsCuantos < 16) cmdsCuantos++;
      manejarComando(c[0], c + 1, fin);
    }
    Escritor t(CMD_ACK, NODO_ID, siguienteSeq());
    t.u16(m.seq);
    t.u8(PASS);
    delay(random(30, 150));
    if (t.firmar(clave)) placa::transmitir(t.datos(), t.largo());
    conEnlace = true;
  }
}

void setup() {
  Serial.begin(115200);
  randomSeed(ESP.getEfuseMac());
  claveNodo(CLAVE_RED, NODO_ID, clave);
  iniciarSeq();
  placa::iniciarPantalla();
  radioOk = placa::iniciarRadio();
  iniciarBLE();
  limpiarOT();
  mostrar(NOMBRE, radioOk ? "Sin OT. Esperando al MES" : "Radio NO RESPONDE", radioOk ? GRIS : ROJO);
  Serial.printf("LISTO terminal %s (nodo %u). Escanee o escriba un codigo y Enter.\n", NOMBRE, NODO_ID);
}

void loop() {
  recibir();
  bombear();

  static uint32_t proximoLatido = 3000;
  if (radioOk && (int32_t)(millis() - proximoLatido) >= 0 && !enVuelo) {
    latido();
    // Sin OT (recién reiniciada) el latido va cada 10 s: si uno se pierde en el aire, el gateway la resincroniza pronto
    proximoLatido = millis() + (ot.length() ? LATIDO_MS : 10000);
  }

  String linea;
  if (placa::leerLinea(entrada, linea)) escanear(linea);

  // Códigos que llegan por Bluetooth (uno por línea)
  String desdeBLE;
  portENTER_CRITICAL(&muxBLE);
  int nl = colaBLE.indexOf('\n');
  if (nl >= 0) {
    desdeBLE = colaBLE.substring(0, nl);
    colaBLE = colaBLE.substring(nl + 1);
  }
  portEXIT_CRITICAL(&muxBLE);
  desdeBLE.trim();
  if (desdeBLE.length()) escanear(desdeBLE);

  static uint32_t ultimoDibujo = 0;
  if (redibujar && millis() - ultimoDibujo > 150) {
    dibujar();
    redibujar = false;
    ultimoDibujo = millis();
  }
}
