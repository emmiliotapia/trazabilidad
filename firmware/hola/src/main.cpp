// Paso 0: "Hola" en la pantalla y revisión del chip de radio.
// No transmite por LoRa: es seguro aunque la antena no esté puesta.
#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <SSD1306Wire.h>

// Pines de la Heltec WiFi LoRa 32 V2
const int PIN_OLED_SDA = 4, PIN_OLED_SCL = 15, PIN_OLED_RST = 16;
const int PIN_LORA_SCK = 5, PIN_LORA_MISO = 19, PIN_LORA_MOSI = 27, PIN_LORA_SS = 18, PIN_LORA_RST = 14, PIN_LORA_DIO0 = 26;
const int PIN_LED = 25;     // LED blanco de la placa
const int PIN_PRG = 0; // botón PRG (en LOW cuando se aprieta)

SSD1306Wire pantalla(0x3c, PIN_OLED_SDA, PIN_OLED_SCL);
bool radioOk = false;
int vecesBoton = 0;

void dibujar(const String &l3) {
  pantalla.clear();
  pantalla.setFont(ArialMT_Plain_16);
  pantalla.drawString(0, 0, "Hola ASETI");
  pantalla.setFont(ArialMT_Plain_10);
  pantalla.drawString(0, 20, radioOk ? "Radio SX1276: OK" : "Radio: NO RESPONDE");
  pantalla.drawString(0, 32, "Chip: " + String(ESP.getChipModel()));
  pantalla.drawString(0, 44, l3);
  pantalla.display();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_PRG, INPUT_PULLUP);

  // La pantalla necesita un pulso de reinicio antes de usarse
  pinMode(PIN_OLED_RST, OUTPUT);
  digitalWrite(PIN_OLED_RST, LOW);
  delay(50);
  digitalWrite(PIN_OLED_RST, HIGH);
  pantalla.init();
  pantalla.flipScreenVertically();

  // Preguntar al chip de radio si está ahí (lee su número de versión; no transmite)
  SPI.begin(PIN_LORA_SCK, PIN_LORA_MISO, PIN_LORA_MOSI, PIN_LORA_SS);
  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  radioOk = LoRa.begin(915E6);
  if (radioOk) LoRa.sleep(); // la dejamos dormida

  uint64_t mac = ESP.getEfuseMac();
  Serial.println();
  Serial.println("=== Hola ASETI ===");
  Serial.printf("Chip: %s rev %d, %lu MHz\n", ESP.getChipModel(), ESP.getChipRevision(), (unsigned long)ESP.getCpuFreqMHz());
  Serial.printf("Numero de serie (MAC): %012llX\n", mac);
  Serial.println(radioOk ? "Radio SX1276: OK (915 MHz)" : "Radio: NO RESPONDE (revisar pines)");
  dibujar("Aprieta PRG");
}

void loop() {
  // Parpadeo del LED: confirma que el programa está corriendo
  digitalWrite(PIN_LED, (millis() / 500) % 2);

  if (digitalRead(PIN_PRG) == LOW) {
    vecesBoton++;
    Serial.printf("Boton PRG: %d\n", vecesBoton);
    dibujar("PRG apretado: " + String(vecesBoton));
    while (digitalRead(PIN_PRG) == LOW) delay(10); // esperar a que lo suelte
    delay(50);
  }
}
