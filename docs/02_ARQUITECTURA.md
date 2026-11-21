# 02 · Arquitectura (preliminar)

> **Última actualización:** 2026-11-21
> **Estado:** Propuesta inicial, todavía sin validar en la planta.

## Vista general

```
 [Lector de códigos] → [Nodo LoRa en máquina/estación] ))) LoRa 915 MHz ((( [Gateway LoRa]
                          · valida localmente                                    │ USB / Ethernet
                          · pantalla OLED / semáforo                             ▼
                          · guarda eventos si no hay señal              [Servidor en planta]
                                                                         · MQTT (Mosquitto)
                                                                         · Backend (API)
                                                                         · Base de datos
                                                                         · Panel web de monitoreo
```

## Componentes

### 1. Nodo por máquina o estación

- **Placa:** Heltec WiFi LoRa 32 (ESP32 + radio LoRa + pantalla OLED). Ya tenemos una (`referencias/placa_lora32.jpeg`).
  - PENDIENTE confirmar la versión (V2 con SX1276 o V3 con ESP32-S3 + SX1262) y que sea de **915 MHz** (banda de México).
- **Lector de códigos:** se recomienda un módulo con salida **serial (UART)**, por ejemplo de la familia GM65/GM67. Un lector USB común no se conecta directo a un ESP32 normal.
- **Indicadores:** pantalla OLED de la placa, más LED o semáforo y buzzer para PASA / FALLA.
- **Alimentación:** PENDIENTE (¿5 V de la máquina? ¿fuente propia?).

### 2. Gateway

- Una placa LoRa igual a las de los nodos (o un gateway comercial si crece la red), conectada al servidor por USB o Ethernet.
- Recibe los eventos de los nodos y los publica en MQTT.
- Envía a los nodos los cambios de WO (qué pieza, resina y molde corresponden a cada máquina).

### 3. Servidor en planta

- **MQTT (Mosquitto):** recibe los eventos del gateway.
- **Backend:** registra eventos, gestiona WOs y emite alertas. Opción considerada: FastAPI.
- **Base de datos:** historial completo de trazabilidad (por WO, lote, bolsa, caja, tarima). Opción considerada: MySQL.
- **Panel web:** estado de las máquinas, alertas de los gates y búsqueda por lote o caja. Existe un prototipo visual en `referencias/panel_simulado_v0.html`, pero sus CPs son genéricos y **no coinciden** con el flujo real; hay que rehacerlo con los CPs de `01_CONTEXTO.md`.

## Principio clave: validar en el nodo, no en el servidor

LoRa transmite **muy pocos datos** (mensajes cortos, de decenas de bytes, y pocas transmisiones por segundo en toda la red). Por eso:

1. Cada nodo tiene guardada la **WO activa** de su máquina y lo que es válido para ella.
2. Al escanear, el nodo responde **PASA / FALLA al instante**, aunque no haya señal.
3. Después envía un **evento corto** al gateway (quién, qué, cuándo, resultado).
4. Si no hay señal, el nodo guarda los eventos y los reenvía cuando vuelve.

Con esto el sistema sigue protegiendo la línea aunque LoRa falle un momento.

## Ejemplo de mensaje de evento (borrador)

| Campo | Ejemplo | Nota |
|---|---|---|
| nodo | `INJ-06` | máquina o estación |
| cp | `06` | checkpoint |
| wo | `WO-2611-042` | orden de trabajo |
| codigo | `RES01-...` | lo escaneado (o un hash corto) |
| resultado | `PASA` / `FALLA` | |
| hora | contador o timestamp | |

Objetivo: menos de ~50 bytes por mensaje, para que cada transmisión sea rápida.

## Riesgos técnicos

| Riesgo | Mitigación |
|---|---|
| Alcance de LoRa entre pisos o con estructuras metálicas | Prueba de campo con dos placas antes de comprar todo; agregar repetidores si hace falta |
| Muchas máquinas transmitiendo a la vez | Mensajes cortos, reintentos con espera aleatoria, confirmación (ACK) |
| Cambio de WO que no llega al nodo | El nodo muestra en pantalla qué WO tiene cargada; el operador lo confirma |
| Interferencia eléctrica de las máquinas | LoRa la tolera mejor que WiFi, pero hay que medirlo en la planta |

## Siguiente paso técnico

**Prueba de concepto con 2 placas:** escanear un código → validar en el nodo → mostrar PASA/FALLA → enviar por LoRa → recibir en el gateway. Después, una prueba de alcance dentro de la planta.
