// Lo común de la Heltec WiFi LoRa 32 V2: pines, pantalla y radio con la misma configuración
// para todos los programas (terminal, gateway, alcance). Si cambias la radio aquí, cambia en todos.
#pragma once
#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <SSD1306Wire.h>

namespace placa {

const int PIN_OLED_SDA = 4, PIN_OLED_SCL = 15, PIN_OLED_RST = 16;
const int PIN_LORA_SCK = 5, PIN_LORA_MISO = 19, PIN_LORA_MOSI = 27, PIN_LORA_SS = 18, PIN_LORA_RST = 14, PIN_LORA_DIO0 = 26;
const int PIN_LED = 25;
const int PIN_PRG = 0;

// Radio: igual que CONFIG.lora del simulador (US915, SF7, 125 kHz, CR 4/5, preámbulo 8)
const long FRECUENCIA = 915E6;
const int SF = 7;
const long ANCHO_BANDA = 125E3;
const int CODING_RATE = 5; // 4/5
const int POTENCIA_DBM = 17;

inline SSD1306Wire &pantalla() {
  static SSD1306Wire p(0x3c, PIN_OLED_SDA, PIN_OLED_SCL);
  return p;
}

inline void iniciarPantalla() {
  pinMode(PIN_OLED_RST, OUTPUT);
  digitalWrite(PIN_OLED_RST, LOW);
  delay(50);
  digitalWrite(PIN_OLED_RST, HIGH);
  pantalla().init();
  pantalla().flipScreenVertically();
}

// Devuelve false si el chip de radio no contesta
inline bool iniciarRadio() {
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_PRG, INPUT_PULLUP);
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_SS);
  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(FRECUENCIA)) return false;
  LoRa.setSpreadingFactor(SF);
  LoRa.setSignalBandwidth(ANCHO_BANDA);
  LoRa.setCodingRate4(CODING_RATE);
  LoRa.setPreambleLength(8);
  LoRa.setTxPower(POTENCIA_DBM);
  LoRa.enableCrc();
  return true;
}

// Transmite y deja la radio lista para escuchar otra vez (la escucha se reactiva con LoRa.parsePacket())
inline void transmitir(const uint8_t *datos, size_t largo) {
  digitalWrite(PIN_LED, HIGH);
  LoRa.beginPacket();
  LoRa.write(datos, largo);
  LoRa.endPacket(); // espera a que termine de salir
  digitalWrite(PIN_LED, LOW);
}

// Lee una línea del puerto USB sin detener el programa. Devuelve true cuando hay una línea completa.
inline bool leerLinea(String &buffer, String &linea) {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\r' || ch == '\n') {
      if (buffer.length() == 0) continue;
      linea = buffer;
      buffer = "";
      return true;
    }
    if (buffer.length() < 400) buffer += ch;
  }
  return false;
}

} // namespace placa
