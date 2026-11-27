# 02 · Arquitectura

> **Última actualización:** 2026-11-21
> **Estado:** Propuesta. Comunicación de piso por LoRa con traducción a MQTT. Falta validarla en la planta (prueba de alcance).

## Vista general

```
 CAPA 1 · Campo          CAPA 2 · Edge (nodos)              CAPA 3 · Servidor en planta                CAPA 4 · Empresa
 ───────────────         ─────────────────────              ────────────────────────────               ────────────────
 Lector QR/barras ─UART─► Nodo ESP32 + LoRa                  Gateway LoRa ──USB serial──► Puente         ERP
 Báscula ─RS-232────────► · valida el gate local    ))) LoRa (((                  LoRa↔MQTT               WMS
 Andon / buzzer ◄───────  · pantalla / semáforo      915 MHz                          │                   Cuarentena Calidad
                          · búfer en flash (NVS)                                      ▼                   Tableros de supervisión
                                                                                Mosquitto (MQTT)
                                                                                      │
                                                                              Backend MES ──► Base SQL
                                                                              (OT, gates,      (genealogía)
                                                                               genealogía)  ──REST──► ERP / WMS
```

La regla de fondo: **LoRa solo lleva mensajes cortos entre los nodos y el gateway.** Todo lo "pesado" (JSON, REST, WebSocket, TLS, integración con ERP/WMS) pasa **del gateway hacia arriba**, donde sí hay cable.

## Capas

### Capa 1 · Dispositivos de campo

- **Lectores QR/código de barras** con salida **serial (UART)**, familia GM65/GM67 o similar. Un lector USB-HID común no se conecta directo a un ESP32 normal.
- **Básculas** con salida RS-232 (vía convertidor a TTL) para CP 07. PENDIENTE confirmar modelo.
- **Andon / semáforo y buzzer** en cada celda.
- **Cámara cenital** en pre-envío (CP 15). No va por LoRa; ver "Estaciones especiales".

### Capa 2 · Nodos edge (uno por inyectora y por estación)

- **Placa:** Heltec WiFi LoRa 32 **V2** o compatible (ESP32 clásico + radio **SX1276** + OLED 0.96"), banda **915 MHz**. Confirmado el 2026-11-27 con las 2 placas de prueba (etiqueta: "SX1276 ESP32 LoRa 915 MHz OLED 0.96", SKU AR3187). El ESP32 clásico trae Bluetooth clásico y BLE.
- **Validación local del gate:** el nodo responde PASS/FAIL al instante, aunque no haya señal.
- **Datos que el nodo guarda localmente (los recibe del servidor por downlink):**
  - OT activa asignada a esa máquina, SKU de producto y de resina.
  - Total de bolsas n, siguiente correlativo esperado y tolerancia de peso/conteo (CP 07).
  - Lista de operadores habilitados (IDs o hash corto) para CP 06.
- **Búfer "store and forward"** en flash (NVS/LittleFS): si no hay ACK, el evento se guarda y se reenvía después.

### Capa 3 · Servidor en planta

- **Gateway LoRa:** recibe los mensajes de los nodos y se los pasa al puente.
- **Puente LoRa ↔ MQTT:** traduce los mensajes binarios a JSON y los publica en MQTT; al revés, convierte los comandos MQTT en mensajes LoRa hacia los nodos (ver la sección siguiente).
- **Mosquitto:** broker MQTT.
- **Backend MES** (FastAPI propuesto): estados de OT, reglas de gate que necesitan datos globales (duplicados entre estaciones, cajas, tarimas), genealogía, alertas.
- **Base de datos SQL** (MySQL propuesto): `Lote MP → OT → Bolsa → Caja → Tarima → Embarque`.

### Capa 4 · Supervisión y sistemas de la empresa

- Panel web de supervisión y Andon consolidado (rehacer `referencias/panel_simulado_v0.html` con los CP vigentes).
- Cuarentena electrónica de Calidad.
- Integración REST con **ERP** y **WMS** (PENDIENTE: saber cuáles son).

## Traducción LoRa → MQTT

### Opciones de gateway

| | A · LoRa punto a punto + puente propio | B · LoRaWAN + ChirpStack |
|---|---|---|
| Hardware de gateway | Una Heltec LoRa32 por USB al servidor | Gateway comercial de 8 canales (ej. RAK7268, Dragino LPS8) |
| Traducción a MQTT | Script propio (Python: `pyserial` + `paho-mqtt`) | ChirpStack ya publica en MQTT; solo se decodifica el payload |
| Canales | 1 (un solo canal y SF fijo) | 8 simultáneos (US915, sub-banda 2) |
| Seguridad | Hay que agregarla (cifrado/firma propios) | AES-128 incluido en el estándar |
| Comandos al nodo (cambio de OT) | Directos e inmediatos | Requiere nodos Clase C (alimentados, sin problema aquí) |
| Costo y complejidad | Bajo, ideal para la prueba de concepto | Mayor, pero más robusto para 51+ nodos |

**Recomendación:** prueba de concepto con **A**. El formato de mensaje y los tópicos MQTT se diseñan iguales para los dos casos, así se puede pasar a **B** en producción sin tocar el backend.

### Tópicos MQTT (borrador)

| Tópico | Sentido | Contenido |
|---|---|---|
| `aseti/p1/nodo/{nodo}/evento` | nodo → servidor | Escaneo y resultado del gate |
| `aseti/p1/nodo/{nodo}/estado` | nodo → servidor | Latido: RSSI, SNR, eventos en búfer, OT cargada (retenido) |
| `aseti/p1/nodo/{nodo}/cmd` | servidor → nodo | Cargar OT, desbloquear, sincronizar hora, actualizar operadores |
| `aseti/p1/nodo/{nodo}/ack` | servidor → nodo | Confirmación de eventos recibidos (por `seq`) |
| `aseti/p1/alerta` | backend → tableros | Alertas de gate para Andon y supervisión |

### Mensaje por LoRa (binario, objetivo < 50 bytes)

| Campo | Bytes | Nota |
|---|---|---|
| versión + tipo de mensaje | 1 | evento / estado / ack / cmd |
| id de nodo | 2 | ej. 6 = INJ-06 |
| seq | 2 | contador por nodo; sirve para el ACK y para eliminar duplicados |
| cp | 1 | 1–16 |
| resultado + código de falla | 1 | PASS/FAIL + motivo |
| timestamp | 4 | epoch; el nodo sincroniza la hora con el gateway |
| datos del CP | variable | IDs cortos (OT, operador, bolsa k/n, peso) |
| firma | 4 | firma truncada (solo opción A) |

### El mismo evento ya traducido a JSON en MQTT (ejemplo CP 06)

```json
{
  "nodo": "INJ-06",
  "seq": 1234,
  "cp": 6,
  "ot": "OT-2611-042",
  "operador": "E1023",
  "maquina": "INJ-06",
  "resultado": "PASS",
  "ts_nodo": "2026-11-21T10:42:05-06:00",
  "ts_gateway": "2026-11-21T10:42:06-06:00",
  "rssi": -92,
  "snr": 7.5,
  "diferido": false
}
```

`diferido: true` indica que el evento salió del búfer después de una desconexión.

### Reglas de entrega

1. El nodo envía el evento y espera ACK con su `seq`. Sin ACK, reintenta con espera aleatoria y, si sigue sin respuesta, lo deja en el búfer.
2. El backend descarta duplicados por `(nodo, seq)`.
3. Los comandos (`cmd`) también llevan `seq` y el nodo los confirma, sobre todo el **cambio de OT**.
4. El nodo muestra en pantalla la OT que tiene cargada para que el operador la confirme.

## Estaciones especiales

- **SM1 / pantalla AV (CP 11–12):** maneja muchos escaneos seguidos y una pantalla gráfica. Se propone un equipo local (PC o tablet industrial) con la lógica de la caja. Si SM1 no tiene red cableada, envía los eventos por un nodo LoRa como cualquier otra estación. PENDIENTE (pregunta 6 de `01_CONTEXTO.md`).
- **Cámara cenital (CP 15):** el video no puede ir por LoRa. Se necesita un equipo local de visión junto a la cámara; por LoRa (o cable, si hay) solo sale el resultado (`o o x x`, 2/4, PASS/FAIL).

### Tres líneas, un gateway, varios canales

La planta tiene 3 líneas (L1: 22, L2: 20, L3: 9 inyectoras) que comparten MP, mezanina, SM1, PT y embarque. Se usa **un solo gateway** que escucha **varios canales a la vez**, y cada grupo de terminales transmite en el suyo:

| Canal | Quién transmite |
|---|---|
| 1 | Línea 1 (L1-INY-01 a L1-INY-22) |
| 2 | Línea 2 (L2-INY-01 a L2-INY-20) |
| 3 | Línea 3 (L3-INY-01 a L3-INY-09) |
| 4 | MP, mezanina, puestos de PT y cámara |
| 5 y 6 | Mesas de SM1, repartidas (escanean las bolsas de todas las líneas) |

Solo chocan dos mensajes que se cruzan en el mismo canal. El gateway contesta (ACK y comandos) en el canal de la terminal.

**Implicación de hardware:** una Heltec LoRa32 tiene una sola radio y escucha un canal a la vez. Para varios canales simultáneos se necesita un gateway con concentrador de 8 canales (SX1302/SX1303), por ejemplo RAK7268 o un RAK2287 sobre Raspberry Pi. Ese gateway se puede usar con LoRaWAN (opción B) o reenviando las tramas crudas a nuestro puente; el formato de mensaje y los tópicos no cambian. La prueba de concepto con 2 placas sigue siendo la opción A. Ver D16.

**Identificador de nodo:** línea × 100 + número de máquina (L2-INY-05 = 205). Estaciones compartidas en el 900: MP 901, mezanina 902, SM1 911–914, PT 921–922, visión 931.

## Capacidad estimada

Con SF7 y 125 kHz, un mensaje de ~40 bytes ocupa el aire unos 80–100 ms. En la simulación con 51 inyectoras y 1 bolsa cada 90 s por máquina, ningún canal pasa de ~10 % de ocupación y ~8 % de las tramas chocan (los reintentos lo absorben). Con un solo canal para todo, las colisiones subían a ~19 %. Hay que medirlo en la prueba de campo, sobre todo hacia la mezanina (2do piso).

## Riesgos técnicos

| Riesgo | Mitigación |
|---|---|
| Alcance entre pisos o con estructuras metálicas | Prueba de campo con dos placas antes de comprar todo; repetidores o segundo gateway si hace falta |
| Muchos nodos transmitiendo a la vez | Mensajes cortos, reintentos con espera aleatoria, ACK; LoRaWAN multicanal si crece |
| Cambio de OT que no llega al nodo | Comando con ACK; la OT cargada se ve en pantalla y en el tópico `estado` |
| Hora incorrecta en el nodo (sin señal) | Sincronización en cada ACK; se guarda también la hora del gateway |
| Mensajes falsos o alterados por radio | Firma en opción A; AES de LoRaWAN en opción B |
| Interferencia eléctrica de las máquinas | LoRa la tolera mejor que WiFi, pero hay que medirlo en la planta |

## Simulador

En `simulador/` está la arquitectura completa funcionando en software (ver `simulador/README.md`). El protocolo binario de referencia es `simulador/src/protocolo/trama.js` y el esquema SQL es `simulador/sql/esquema.sql`.

## Siguiente paso técnico

**Prueba de concepto con 2 placas (opción A):** escanear gafete, OT y QR (CP 06) → validar en el nodo → PASS/FAIL en pantalla → enviar por LoRa → el gateway lo pasa por USB → el puente lo publica en MQTT → verlo con `mosquitto_sub`. Después, la prueba de alcance en planta.
