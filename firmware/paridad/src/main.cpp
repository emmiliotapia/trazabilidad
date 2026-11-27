// Prueba de paridad del protocolo. Atiende órdenes por el puerto USB (115200):
//   E          → imprime las tramas de ejemplo que arma el ESP32: "V<n> <hex>", y al final "FIN"
//   D <hex>    → lee una trama y la imprime: "D OK tipo=.. nodo=.. ..." o "D ERR <motivo>"
// Los ejemplos deben ser los mismos que en simulador/herramientas/vectores-paridad.mjs.
#include <Arduino.h>
#include <trama.h>

using namespace trama;

const char *CLAVE_RED = "aseti-demo-clave-2026"; // CONFIG.claveRed del simulador

void imprimirHex(const uint8_t *b, size_t n) {
  for (size_t i = 0; i < n; i++) Serial.printf("%02x", b[i]);
}

void enviarVector(int num, Escritor &t, uint16_t nodo) {
  uint8_t clave[LARGO_CLAVE];
  claveNodo(CLAVE_RED, nodo, clave);
  size_t n = t.firmar(clave);
  Serial.printf("V%d ", num);
  if (n == 0) Serial.print("NO_CUPO");
  else imprimirHex(t.datos(), n);
  Serial.println();
}

void vectores() {
  { // 1 · CP 06 arranque correcto
    Escritor t(EVENTO, 106, 1);
    t.u8(6); t.u8(PASS); t.u32(1795000000);
    t.texto(OT, "OT-2611-042"); t.texto(OPERADOR, "E1023"); t.texto(MAQUINA, "L1-INY-06");
    enviarVector(1, t, 106);
  }
  { // 2 · CP 07 peso fuera de tolerancia, seq en su valor máximo
    Escritor t(EVENTO, 205, 65535);
    t.u8(7); t.u8(PESO_FUERA_TOLERANCIA); t.u32(1795000123);
    t.texto(OT, "OT-2611-042"); t.campoU16(BOLSA, 3); t.campoU16(TOTAL, 12); t.campoU16(PESO, 1250); t.texto(OPERADOR, "E1023");
    enviarVector(2, t, 205);
  }
  { // 3 · latido de estado, terminal bloqueada con 3 eventos en memoria
    Escritor t(ESTADO, 205, 7);
    t.u32(1795000200); t.u16(3); t.u8(1);
    t.texto(OT, "OT-2611-042");
    enviarVector(3, t, 205);
  }
  { // 4 · confirmación de un comando
    Escritor t(CMD_ACK, 106, 9);
    t.u16(4); t.u8(PASS);
    enviarVector(4, t, 106);
  }
  { // 5 · CP 11 bolsa duplicada en una mesa de SM1
    Escritor t(EVENTO, 911, 300);
    t.u8(11); t.u8(DUPLICADO); t.u32(1795000300);
    t.texto(OT, "OT-2611-042"); t.campoU16(BOLSA, 5); t.texto(CAJA, "CJ-0001"); t.campoU8(POSICION, 2); t.campoU16(TOTAL, 4); t.texto(OPERADOR, "E2001");
    enviarVector(5, t, 911);
  }
  Serial.println("FIN");
}

void imprimirCampos(const uint8_t *p, const uint8_t *fin) {
  uint8_t tag, n;
  const uint8_t *v;
  while (siguienteCampo(p, fin, tag, v, n)) {
    const DefCampo *d = defCampo(tag);
    if (!d) continue; // campo desconocido: se ignora, igual que trama.js
    Serial.printf(" %s=", d->nombre);
    if (d->tipo == U8) Serial.print(v[0]);
    else if (d->tipo == U16) Serial.print(leerU16(v));
    else Serial.write(v, n);
  }
}

void leerTrama(const String &hex) {
  static uint8_t buf[MAX_TRAMA];
  size_t n = hex.length() / 2;
  if (n > MAX_TRAMA) n = MAX_TRAMA;
  for (size_t i = 0; i < n; i++) buf[i] = strtoul(hex.substring(i * 2, i * 2 + 2).c_str(), nullptr, 16);

  Leida cab;
  if (!leerCabecera(buf, n, cab)) {
    Serial.printf("D ERR %s\n", cab.error);
    return;
  }
  uint8_t clave[LARGO_CLAVE];
  claveNodo(CLAVE_RED, cab.nodo, clave);
  Leida m = leer(buf, n, clave);
  if (!m.ok) {
    Serial.printf("D ERR %s\n", m.error);
    return;
  }
  const uint8_t *c = m.cuerpo, *fin = m.cuerpo + m.largoCuerpo;
  Serial.printf("D OK tipo=%u nodo=%u seq=%u", m.tipo, m.nodo, m.seq);
  switch (m.tipo) {
    case EVENTO:
      Serial.printf(" cp=%u resultado=%u ts=%lu", c[0], c[1], (unsigned long)leerU32(c + 2));
      imprimirCampos(c + 6, fin);
      break;
    case ESTADO:
      Serial.printf(" ts=%lu bufer=%u bloqueado=%u", (unsigned long)leerU32(c), leerU16(c + 4), c[6]);
      imprimirCampos(c + 7, fin);
      break;
    case ACK:
      Serial.printf(" seqAck=%u ts=%lu", leerU16(c), (unsigned long)leerU32(c + 2));
      break;
    case CMD:
      Serial.printf(" codigo=%u", c[0]);
      imprimirCampos(c + 1, fin);
      break;
    case CMD_ACK:
      Serial.printf(" seqCmd=%u resultado=%u", leerU16(c), c[2]);
      break;
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(2000);
  delay(200);
  Serial.println("LISTO paridad");
}

void loop() {
  if (!Serial.available()) return;
  String linea = Serial.readStringUntil('\n');
  linea.trim();
  if (linea == "E") vectores();
  else if (linea.startsWith("D ")) leerTrama(linea.substring(2));
}
