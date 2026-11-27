// Gateway LoRa: un "traductor" sin lógica entre la radio y la computadora del MES.
//   Radio → USB:  cada trama recibida sale como  "RX <hex> <rssi> <snr>"
//   USB → radio:  cada línea "TX <hex>" se transmite tal cual
// No revisa firmas ni entiende los mensajes: eso lo hace el puente en la computadora.
#include <Arduino.h>
#include <placa.h>

String entrada;
uint32_t recibidas = 0, enviadas = 0;
int ultimoRssi = 0;
float ultimoSnr = 0;
uint16_t ultimoNodo = 0;
bool radioOk = false;
bool cambio = true;

void dibujar() {
  auto &p = placa::pantalla();
  p.clear();
  p.setFont(ArialMT_Plain_16);
  p.drawString(0, 0, "GATEWAY");
  p.setFont(ArialMT_Plain_10);
  if (!radioOk) {
    p.drawString(0, 22, "Radio NO RESPONDE");
  } else {
    p.drawString(0, 20, "Recibidos: " + String(recibidas));
    p.drawString(0, 32, "Enviados:  " + String(enviadas));
    if (recibidas) p.drawString(0, 44, "Ult: nodo " + String(ultimoNodo) + "  " + String(ultimoRssi) + " dBm");
  }
  p.display();
}

void setup() {
  Serial.begin(115200);
  placa::iniciarPantalla();
  radioOk = placa::iniciarRadio();
  dibujar();
  Serial.println(radioOk ? "LISTO gateway" : "ERROR radio");
}

void loop() {
  // Radio → USB
  int n = LoRa.parsePacket();
  if (n > 0) {
    uint8_t buf[256];
    int i = 0;
    while (LoRa.available() && i < (int)sizeof buf) buf[i++] = (uint8_t)LoRa.read();
    ultimoRssi = LoRa.packetRssi();
    ultimoSnr = LoRa.packetSnr();
    if (i >= 3) ultimoNodo = (uint16_t)(buf[1] << 8 | buf[2]);
    Serial.print("RX ");
    for (int j = 0; j < i; j++) Serial.printf("%02x", buf[j]);
    Serial.printf(" %d %.1f\n", ultimoRssi, ultimoSnr);
    recibidas++;
    cambio = true;
  }

  // USB → radio
  String linea;
  if (placa::leerLinea(entrada, linea) && linea.startsWith("TX ")) {
    String hex = linea.substring(3);
    hex.trim();
    uint8_t buf[256];
    size_t largo = hex.length() / 2;
    if (largo > 0 && largo <= sizeof buf) {
      for (size_t j = 0; j < largo; j++) buf[j] = (uint8_t)strtoul(hex.substring(j * 2, j * 2 + 2).c_str(), nullptr, 16);
      placa::transmitir(buf, largo);
      enviadas++;
      cambio = true;
    }
  }

  // Redibujar como máximo 4 veces por segundo para no dejar de escuchar la radio
  static uint32_t ultimoDibujo = 0;
  if (cambio && millis() - ultimoDibujo > 250) {
    dibujar();
    cambio = false;
    ultimoDibujo = millis();
  }
}
