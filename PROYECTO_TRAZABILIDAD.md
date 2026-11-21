# Proyecto de Trazabilidad · Inyección de plástico (documento consolidado)

> Generado el 2026-11-21 10:43. Este archivo se arma a partir de docs/. No editarlo a mano.


---

# 01 · Contexto del proyecto

> **Última actualización:** 2026-11-21
> **Estado:** Borrador inicial. Faltan datos de la planta (ver "Preguntas abiertas").

## Resumen en una línea

Sistema de trazabilidad para una planta de inyección de plástico: en cada punto de control se escanea un código y el sistema valida al momento si la pieza, el material o la caja es la correcta, comunicándose por **LoRa** porque no se puede cablear y el WiFi tiene interferencia.

## El problema

- Hubo una **equivocación en la planta** (una pieza o material incorrecto avanzó en el proceso). El sistema busca que no vuelva a pasar y que quede registro de cada paso.
- **Detalle exacto del error: PENDIENTE.** Es el dato más importante, porque define qué checkpoints son críticos.

## Restricciones de la planta

- **Cableado:** complicado de instalar por la infraestructura de la planta.
- **WiFi:** las máquinas de inyección interfieren con la señal y es poco confiable.
- **Propuesta:** dispositivos **LoRa** para distribuir la comunicación sin depender de cable ni WiFi.

## El flujo real: 16 checkpoints (CP 01 a CP 16)

Fuente: diagrama de la empresa (`referencias/diagrama_flujo_CP01-CP16.jpeg`).

### Etapa 1 · Recepción y preparación de materia prima (CP 01–04)

| CP | Nombre | Qué pasa | Responsable |
|---|---|---|---|
| CP 01 | Recepción de resina | Almacén recibe la materia prima y genera la etiqueta inicial | Almacén |
| CP 02 | Traslado a producción | Almacén sube la materia prima al segundo piso | Almacén |
| CP 03 | Programación de orden | Producción verifica WO, máquina, dado (molde) y tiempos | Operador |
| CP 04 | Verificación de resina | Escaneo y validación **gate** visual en el embudo (etiqueta resina RES01/RES02) | Almacén y operador |

### Etapa 2 · Moldeo y conteo en máquina (CP 05–08)

| CP | Nombre | Qué pasa | Responsable |
|---|---|---|---|
| CP 05 | Liberación de WO | Emisión de sobre con la WO e instrucciones | Operador de moldeo |
| CP 06 | Validación en máquina | El operador escanea **gafete, WO y QR de máquina**; se muestra en pantalla ESP. **Gate / alerta** | Operador de moldeo |
| CP 07 | Embolsado y pesado | El operador llena, pesa o cuenta piezas por bolsa | Operador de moldeo |
| CP 08 | Etiquetado correlativo | Etiquetas secuenciales por bolsa (001, 002, 003…) | Operador de moldeo |

### Etapa 3 · Inspección y empaque secundario (CP 09–12)

| CP | Nombre | Qué pasa | Responsable |
|---|---|---|---|
| CP 09 | Control de charolas | El charolero retira charolas hacia la estación SM1. Alerta de charolas estorbando | Charolero |
| CP 10 | Inspección visual 1 | El inspector 1 valida piezas al azar y sella. **Gate / alerta** | Inspector 1 |
| CP 11 | Empaque en caja | Escaneo de **gafete, WO y bolsa** en AV (pantalla AV) | Inspector 1, 2 y charolero |
| CP 12 | Inspección final 2 | El inspector 2 valida que la caja esté completa y la cierra. **Gate / alerta** | Inspector 2 |

### Etapa 4 · Pre-envío y embarque final (CP 13–16)

| CP | Nombre | Qué pasa | Responsable |
|---|---|---|---|
| CP 13 | Ingreso a pre-envío | Escaneo de cajas al ingresar al almacén | Personal de almacén |
| CP 14 | Armado de tarimas | Consolidación de WO en tarima y flejado | Personal de almacén |
| CP 15 | Etiquetado de tarima | Escaneo de etiquetas de tarima con cámara; confirmación por cámara superior (sistema semáforo) | Personal de almacén |
| CP 16 | Despacho en embarque | Traslado a la puerta de embarque, se finaliza el rastreo. **Gate / alerta** | Personal de almacén |

### Puntos con validación tipo "gate" (bloquean si algo no coincide)

CP 04, CP 06, CP 10, CP 12, CP 16 (más la alerta de charolas en CP 09 y el semáforo de CP 15).

## Glosario

- **WO (Work Order):** orden de trabajo. Define qué pieza, en qué máquina, con qué molde y con qué resina.
- **Dado:** el molde de inyección.
- **Gate:** punto donde el sistema puede detener el proceso si la validación falla.
- **AV / SM1:** estaciones de la planta (significado exacto PENDIENTE).
- **Charolero:** persona que mueve las charolas de piezas entre estaciones.
- **Nodo:** dispositivo LoRa instalado en una máquina o estación.
- **Gateway:** dispositivo LoRa central que recibe los datos de los nodos y los pasa al servidor.

## Preguntas abiertas

1. ¿Qué pasó exactamente en la equivocación? (¿resina equivocada, etiqueta cruzada, pieza en la caja de otra WO?)
2. ¿Qué tipo de código se escanea (QR o código de barras)? ¿Lo genera su ERP o lo generamos nosotros?
3. ¿Qué significa "pieza correcta" en cada CP? (por ejemplo: el código de la pieza coincide con la WO cargada en esa máquina)
4. ¿Cuántas máquinas o estaciones hay? (el panel simulado supone 22) ¿Están en uno o en dos pisos?
5. ¿A qué distancia quedaría el gateway de la estación más lejana? ¿Hay muros o estructuras metálicas de por medio?
6. ¿Ya tienen lectores de códigos o hay que elegirlos?
7. ¿Qué significan "AV" y "SM1"?
8. ¿Se integra con algún sistema existente (ERP, MES, Excel)?


---

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


---

# 03 · Registro de decisiones

> **Última actualización:** 2026-11-21
> Cada decisión lleva fecha, estado y motivo. Lo que se descarta se marca **DESCARTADO** pero no se borra.

| # | Fecha | Decisión | Estado | Motivo |
|---|---|---|---|---|
| D1 | 2026-11-21 | Usar **LoRa** para la comunicación entre las estaciones y el servidor | Propuesta | No se puede cablear y el WiFi tiene interferencia por las máquinas |
| D2 | 2026-11-21 | **Validar en el nodo** (local) y enviar el evento después | Propuesta | LoRa tiene poco ancho de banda; la línea no debe detenerse si falla la señal |
| D3 | 2026-11-21 | Placa base: **Heltec WiFi LoRa 32** | En prueba | Ya se tiene una; trae ESP32, radio LoRa y pantalla en una sola placa |
| D4 | 2026-11-21 | Banda de frecuencia **915 MHz** | Por confirmar | Banda permitida en México; confirmar que las placas y antenas sean de 915 MHz |
| D5 | 2026-11-21 | Los CPs del sistema serán los **16 del diagrama de la planta**, no los del panel simulado | Aceptada | El panel simulado usa CPs genéricos que no corresponden al proceso real |
| D6 | 2026-11-21 | Documentación maestra en Markdown dentro del repo y consolidada para NotebookLM | Aceptada | Una sola fuente de verdad, con historial en git |


---

# 04 · Bitácora

> **Última actualización:** 2026-11-21
> Lo más reciente va arriba.

## 2026-11-21

**Hecho**
- Se arma la carpeta del proyecto y el repo.
- Se reciben de la empresa: el diagrama de flujo CP 01–CP 16 y el prototipo visual del panel (`panel_simulado_v0.html`).
- Se tiene físicamente una placa LoRa32 para pruebas.
- Se documentan el contexto, la arquitectura preliminar y las primeras decisiones.

**Pendiente**
- Conseguir el detalle de la equivocación que originó el proyecto.
- Responder las preguntas abiertas de `01_CONTEXTO.md`.
- Confirmar la versión y la frecuencia de la placa.
- Definir y conseguir el lector de códigos para la prueba.
- Prueba de concepto con 2 placas (escaneo → validación → LoRa → gateway).

