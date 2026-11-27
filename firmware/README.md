# Firmware de las terminales (ESP32 + LoRa)

Placa: **Heltec WiFi LoRa 32 V2** (ESP32 clásico, radio SX1276 a 915 MHz, OLED 0.96"). Herramienta: **PlatformIO**.

| Carpeta | Qué es |
|---|---|
| `lib/trama/` | El protocolo de radio en C++. Copia byte a byte de `simulador/src/protocolo/trama.js` |
| `hola/` | Paso 0: "Hola ASETI" en la pantalla, revisa el chip de radio, LED y botón PRG. No transmite |
| `paridad/` | Paso 2: prueba que el ESP32 arma y lee las tramas igual que el simulador |
| `gateway/` | Gateway: pasa lo que oye por radio a la PC por USB (`RX <hex> <rssi> <snr>`) y transmite lo que recibe (`TX <hex>`) |
| `terminal/` | Terminal de inyectora L1-INY-01 (nodo 101): CP 06 y CP 07, cola con ACK y reintentos, comandos del MES. `escaner.py` pasa el lector USB a la placa |
| `lib/placa/` | Pines, pantalla y configuración de radio comunes (915 MHz, SF7, 125 kHz, CR 4/5) |

## Demo con placas reales (esta PC como MES)

1. Subir `gateway/` a una placa y `terminal/` a la otra (ej. gateway en COM9, terminal en COM7).
2. Arrancar el simulador con el gateway real (PowerShell): `cd simulador; $env:GATEWAY_SERIE='COM9'; npm start`
   L1-INY-01 pasa a ser la placa física, queda en modo manual y pide su OT sola; el reloj va a tiempo real.
3. Abrir el panel `http://localhost:8080` y las etiquetas `http://localhost:8080/etiquetas.html?maquina=L1-INY-01`.
4. En otra ventana: `python firmware/terminal/escaner.py COM7`, dejarla activa y escanear: gafete → OT → QR → bolsas.

**Protecciones para la demo** (probadas el 2026-11-27 con dos reinicios y una desconexión del gateway a media OT, sin perder bolsas):
- *La placa se reinicia* (se desconecta, apagón, programa nuevo): pierde la OT de su RAM, pero en ≤10 s su latido avisa y el simulador le devuelve la OT, la bolsa en la que iba y el operador. Pantalla: "Reanudada: sigue la bolsa N".
- *Su número de secuencia* se guarda en la memoria permanente (NVS) por bloques de 256: tras un reinicio no repite números, porque el MES descarta repetidos por `(nodo, seq)` y la bolsa se perdería.
- *Se desconecta el USB del gateway*: el simulador vuelve a abrir COM9 solo cada 3 s.
- *Se cae el Bluetooth del celular*: https://escaner.smartopsia.com se reconecta sola a la misma terminal.
- *La placa conserva una OT que el MES ya cerró*: se le manda FIN_OT.

## Preparar una PC (una sola vez)

1. Driver del chip USB de la placa: **CP210x Universal Windows Driver** de Silicon Labs (clic derecho a `silabser.inf` → Instalar).
2. PlatformIO: `python -m pip install --user platformio`
3. Ver en qué puerto quedó cada placa: `python -m platformio device list` (ej. COM7 y COM9).

## Subir un programa

```
cd firmware/hola
python -m platformio run -t upload --upload-port COM7
python -m platformio device monitor --port COM7      # ver lo que escribe (Ctrl+C para salir)
```

La primera compilación descarga las herramientas del ESP32 (~300 MB, unos minutos).

## Prueba de paridad

```
cd firmware/paridad
python -m platformio run -t upload --upload-port COM7
python comparar.py COM7
```

Debe terminar en *"Todo igual: el ESP32 habla el mismo protocolo que el simulador"*. Si cambias `trama.js` o `lib/trama`, cambia los dos y vuelve a correrla.

## Cuidados

- **Nunca transmitir sin la antena de LoRa enroscada** (la negra, no el resorte: ese es de WiFi/Bluetooth). Sin antena el chip de radio se puede dañar.
- El botón **PRG** es GPIO 0. Si se mantiene apretado al conectar, la placa entra en modo de programación y no corre el programa.
- Pines usados: radio SCK 5, MISO 19, MOSI 27, SS 18, RST 14, DIO0 26 · pantalla SDA 4, SCL 15, RST 16 · LED 25.
- La librería `serialport` de Node con **Node 26 en Windows** solo entrega lo recibido cuando se vuelve a escribir al puerto (visto el 2026-11-27). Por eso la prueba de paridad habla con la placa desde Python. Para el puente del gateway hay que probarla con Node 22 (la versión del proyecto) o usar otra vía.
