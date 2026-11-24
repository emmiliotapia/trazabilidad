# Proyecto de Trazabilidad · Inyección de plástico (documento consolidado)

> Generado el 2026-11-24 10:00. Este archivo se arma a partir de docs/. No editarlo a mano.


---

# 01 · Contexto del proyecto

> **Última actualización:** 2026-11-21
> **Estado:** Flujo de 16 checkpoints actualizado (versión vigente). Quedan preguntas abiertas de la planta.

## Resumen en una línea

Sistema de trazabilidad y control de producción para una planta de inyección de plástico con **51 inyectoras en 3 líneas** (L1: 22, L2: 20, L3: 9) que comparten almacenes, mezanina, SM1, PT y embarque: en cada checkpoint (CP 01–CP 16) se escanea un código y el sistema valida al momento si el material, la bolsa, la caja o la tarima es la correcta. La comunicación de piso es por **LoRa** (no se puede cablear y el WiFi tiene interferencia) y se traduce a **MQTT** en el servidor.

## Objetivo

Trazabilidad unitaria y por contenedor, de punta a punta: desde la recepción de resina (MP) hasta el despacho en la puerta de embarque.

Genealogía que debe quedar registrada:

```
Lote de resina MP → OT → Bolsa correlativa (1..n) → Caja UID → Tarima → Embarque
```

## El problema

- Hubo una **equivocación en la planta** (una pieza o material incorrecto avanzó en el proceso). El sistema busca que no vuelva a pasar y que quede registro de cada paso.
- **Detalle exacto del error: PENDIENTE.** Define cuáles checkpoints son los más críticos.

## Restricciones de la planta

- **Cableado:** complicado de instalar por la infraestructura de la planta.
- **WiFi:** las máquinas de inyección interfieren con la señal y es poco confiable.
- **Solución:** nodos **LoRa** en las estaciones y un gateway que traduce a **MQTT** (ver `02_ARQUITECTURA.md`).

## Convenciones del proyecto

- **OT** (Orden de Trabajo). No se usa "WO".
- **TEP** (Trabajo en Proceso). No se usa "WIP".
- **Sello físico y sello digital coexisten a propósito:** los sellos de tinta en la etiqueta de la bolsa y en la carpeta de la OT se mantienen junto con los escaneos en el sistema.
- **Validation gate:** el paso N no inicia si el paso N-1 no está en PASS.

### Código de colores por rol (matrices y tableros)

| Color | Rol |
|---|---|
| `#FCE4D6` melocotón claro | Almacén Materia Prima (MP) |
| `#FFF2CC` amarillo pálido | Planificación / Operador de resina (mezanina, 2do piso) |
| `#E2EFDA` verde suave | Supervisor de producción / Operador de inyección (piso de planta) |
| `#FFD966` amarillo cálido | Inspector de Calidad 1 (TEP en charolas) |
| `#D9E1F2` azul suave | Charolero / Material handler (traslado y SM1) |
| `#F8CBAD` naranja | Inspector de Calidad 2 / Almacén PT / Embarques |

## El flujo vigente: 16 checkpoints

### Etapa 1 · Materia prima y preparación (CP 01–05)

| CP | Nombre | Responsable | Acción | Gate (condición para pasar) | Datos a capturar | Si falla |
|---|---|---|---|---|---|---|
| 01 | Recepción MP | Almacén MP | Recepción de sacos/lotes de resina, revisión del Certificado de Análisis, etiqueta interna de lote MP | Certificado válido + aprobación de Calidad MP | ID_Lote_MP, SKU_Resina, Proveedor, Cantidad_Kg, Timestamp, ID_Almacenista | Cuarentena MP / rechazo a proveedor |
| 02 | Transferencia a mezanina | Almacén MP | Subir la resina aprobada al 2do piso (tolvas/embudos) | CP 01 = PASS + ubicación física confirmada en 2do piso | ID_Lote_MP, Ubicacion_2doPiso, Timestamp, ID_Almacenista | Retenido en Almacén MP / reubicación |
| 03 | Planificación y preparación ("show") | Planificación / Producción | Liberación del programa; asignación de OT, inyectora, dado/molde, resina y tiempos de ciclo | OT activa + molde disponible + resina confirmada en 2do piso | OT, ID_Maquina, ID_Dado_Molde, SKU_Producto, SKU_Resina, ID_Planificador | Programación pendiente / ajuste de plan |
| 04 | Carga de resina en embudo | Operador de resina (2do piso) | Limpieza de tolva; escaneo de OT y de etiqueta de resina (RES01, RES02) antes de vaciar | CP 03 = PASS + SKU de resina escaneada = formulación de la OT | OT, ID_Lote_MP, SKU_Resina, ID_Embudo, ID_Operador_Resina, Timestamp | Alerta de resina incorrecta / bloqueo de vaciado / aviso a supervisor |
| 05 | Liberación de sobre de OT | Supervisor de producción | Armado del sobre de OT y paquete de etiquetas correlativas 1..n; se coloca en el atril de la inyectora | CP 04 = PASS + parámetros de máquina seteados + paquete 1..n impreso | OT, Total_Bolsas_OT (n), Rango_Etiquetas_Bolsa, ID_Supervisor, Timestamp | Retención del sobre / prohibido arrancar |

### Etapa 2 · Moldeo, inspección TEP y charolas (CP 06–10)

| CP | Nombre | Responsable | Acción | Gate | Datos a capturar | Si falla |
|---|---|---|---|---|---|---|
| 06 | Arranque de inyectora | Operador de inyección | Escaneo en orden: 1) gafete, 2) OT, 3) QR fijo de la máquina. Se muestra en la terminal ESP | CP 05 = PASS + operador habilitado + OT activa asignada a ese QR de máquina | ID_Operador, OT, QR_Maquina, Timestamp | Bloqueo de terminal + Andon + aviso a supervisor |
| 07 | Moldeo, pesaje y embolsado | Operador de inyección | Llenado de bolsa, pesaje en báscula o conteo, cierre y etiqueta correlativa (1..n) | CP 06 = PASS + peso/conteo en tolerancia + secuencia sin saltos | OT, ID_Bolsa_Correlativo (k/n), Peso_o_Piezas_Bolsa, ID_Operador, Timestamp | Ajuste de tara/conteo / scrap de bolsa |
| 08 | Inspección visual TEP 1 | Inspector de Calidad 1 | Muestreo de bolsas en charolas; revisión de rebaba, rechupes, tiros cortos, quemaduras; **sello físico** en la etiqueta de cada bolsa aprobada | CP 07 = PASS + 0 defectos críticos en la muestra | OT, ID_Bolsa_Inspeccionada, Estatus_Visual, ID_Inspector_1, Timestamp | Retención en celda / cuarentena TEP / scrap o retrabajo |
| 09 | Liberación de charolas | Supervisor de producción | Revisión de charolas con sellos del Inspector 1; autoriza el despeje para no saturar pasillos | CP 08 = PASS (sellos confirmados) + pasillo despejado | OT, Cantidad_Charolas_Liberadas, ID_Supervisor, Timestamp | Charola retenida / alerta de saturación |
| 10 | Retiro y traslado a SM1 | Charolero | Retiro de charolas liberadas de cualquier inyectora de las 3 líneas y traslado en carrito a SM1 | CP 09 = PASS | ID_Charolero, ID_Charola/Ruta, Timestamp | Charola regresa a su celda / verificar estatus |

### Etapa 3 · Empaque secundario en SM1 (CP 11–12)

| CP | Nombre | Responsable | Acción | Gate | Datos a capturar | Si falla |
|---|---|---|---|---|---|---|
| 11 | Empaque de bolsas en caja | Charolero | En SM1: escaneo de gafete, de caja y de cada bolsa. La **pantalla AV** muestra las divisiones (ej. 1/4…4/4) y las enciende conforme se escanean | CP 10 = PASS + bolsa de la misma OT + sin duplicados + caja completa (n/n) | ID_Charolero, OT, ID_Caja_UID, ID_Bolsa_Escaneada, Posicion_Division, Timestamp | Alerta roja en AV (duplicado o bolsa de otra OT) / bloqueo de cierre |
| 12 | Inspección final y cierre de caja | Inspector de Calidad 2 | Verifica la pantalla AV, audita bolsas, encinta la caja y sella la OT | CP 11 = PASS + 100 % de bolsas registradas + caja encintada | ID_Inspector_2, OT, ID_Caja_UID, Total_Bolsas_Caja, Estatus_Caja, Timestamp | Re-escaneo / devolución a mesa de empaque |

### Etapa 4 · Producto terminado y embarque (CP 13–16)

| CP | Nombre | Responsable | Acción | Gate | Datos a capturar | Si falla |
|---|---|---|---|---|---|---|
| 13 | Recepción en pre-envío | Charolero / Almacén PT | Traslado de cajas cerradas a Almacén PT; escaneo de ingreso y alta en WMS | CP 12 = PASS (caja encintada + sello de OT) | ID_Caja_UID, OT, ID_Ubicacion_PreEnvio, ID_Almacenista, Timestamp | Caja rechazada / regresa a SM1 |
| 14 | Paletizado y flejado | Almacén PT / Embarques | Con la orden de embarque se juntan las cajas de la OT/N° de parte en tarima y se fleja | CP 13 = PASS + SKU y cantidad de cajas = orden de embarque | ID_Tarima, Orden_Embarque, Numero_Parte, IDs_Cajas, ID_Almacenista | Tarima inconsistente / desarmar y reasignar |
| 15 | Etiquetado de tarima y visión | Almacén PT / visión artificial | 1 a 4 etiquetas maestras en los costados; el operador las escanea con terminal de mano y una **cámara cenital** confirma pallet y lado. Semáforo a distancia con matriz o/x (ej. `o o x x` = 2/4) | CP 14 = PASS + 4/4 confirmado por escáner y cámara | ID_Tarima, Etiquetas_Escaneadas (k/4), Estatus_Camara, Timestamp | Semáforo ámbar/rojo / bloqueo de tarima / re-escaneo |
| 16 | Despacho en puerta de embarque | Almacén PT / Embarques | Con semáforo verde, la tarima va en montacargas a la rampa; se envía el cierre a ERP/WMS | CP 15 = PASS | ID_Tarima, OT, Numero_Puerta_Embarque, Estatus_Trazabilidad (COMPLETO), Timestamp_Salida | Bloqueo de rampa / tarima regresa a pre-embarque |

### Versión anterior del flujo (DESCARTADO)

El diagrama original de la empresa (`referencias/diagrama_flujo_CP01-CP16.jpeg`) tenía otro orden de CP 07 a CP 10: 07 embolsado y pesado, 08 etiquetado correlativo, 09 control de charolas (charolero), 10 inspección visual 1. En la versión vigente el etiquetado se integra a CP 07, la inspección TEP 1 pasa a CP 08 (antes del traslado) y se agrega la liberación de charolas por el supervisor en CP 09. El diagrama se conserva como referencia visual, pero **la numeración vigente es la de este documento**.

## Glosario

- **OT:** Orden de Trabajo. Define qué pieza, en qué máquina, con qué molde y con qué resina.
- **TEP:** Trabajo en Proceso (producto entre moldeo y empaque).
- **MP / PT:** Materia Prima / Producto Terminado.
- **Dado:** el molde de inyección.
- **Mezanina:** 2do piso, donde están las tolvas/embudos de alimentación.
- **Gate:** punto donde el sistema detiene el proceso si la validación falla.
- **ESP / terminal de estación:** nodo con microcontrolador (ESP32 + LoRa) y pantalla en cada inyectora.
- **SM1:** Salida de Moldeo 1. Estación central de empaque secundario en cajas.
- **Pantalla AV:** pantalla de Ayuda Visual en SM1 que muestra las divisiones de la caja.
- **Charolero:** persona que mueve las charolas entre las inyectoras y SM1.
- **Andon:** baliza luminosa de alerta en la celda.
- **Nodo:** dispositivo LoRa instalado en una máquina o estación.
- **Gateway:** dispositivo LoRa central que recibe los mensajes de los nodos y los traduce a MQTT.

## Preguntas abiertas

1. ¿Qué pasó exactamente en la equivocación? (¿resina equivocada, etiqueta cruzada, bolsa en la caja de otra OT?)
2. ¿Los códigos (OT, bolsa, caja, tarima) los genera el ERP o los generamos nosotros? ¿Qué formato tienen?
3. ¿Qué ERP y WMS usan, y cómo se integran (API, base de datos, archivos)?
4. ¿A qué distancia quedaría el gateway de la estación más lejana? ¿Hay muros o estructuras metálicas? (mezanina en 2do piso incluida)
5. ¿Ya tienen lectores de códigos o hay que elegirlos?
6. ¿SM1 y el área de pre-envío (cámara de CP 15) tienen red cableada o también dependen de LoRa?
7. ¿Las básculas de CP 07 tienen salida de datos (RS-232/USB) o la lectura es manual?
8. ¿Cuántas bolsas lleva una caja y cuántas cajas una tarima? ¿Es fijo por número de parte?
9. Con 51 inyectoras: ¿cuántos operadores de resina en la mezanina, cuántas mesas en SM1 y cuántos puestos de paletizado en PT? La simulación supone 3, 4 y 2.

**Resueltas el 2026-11-21:** 3 líneas de producción (22 + 20 + 9 = 51 inyectoras) con estaciones compartidas, nombre de las máquinas (`L1-INY-01`), significado de SM1 y AV, tipo de código (QR y código de barras), y que hay integración con ERP y WMS.


---

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

- **Placa:** Heltec WiFi LoRa 32 (ESP32 + radio LoRa + OLED). PENDIENTE confirmar versión (V2/SX1276 o V3/SX1262) y banda **915 MHz**.
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
| D5 | 2026-11-21 | Los CPs del sistema serán los **16 del diagrama de la planta**, no los del panel simulado | Aceptada (orden de CP 07–10 reemplazado por D7) | El panel simulado usa CPs genéricos que no corresponden al proceso real |
| D6 | 2026-11-21 | Documentación maestra en Markdown dentro del repo y consolidada para NotebookLM | Aceptada | Una sola fuente de verdad, con historial en git |
| D7 | 2026-11-21 | El flujo vigente de 16 CP es la **versión actualizada** (`01_CONTEXTO.md`); el orden de CP 07–10 del diagrama original queda **DESCARTADO** | Aceptada | Es la información más reciente: etiqueta correlativa en CP 07, inspección TEP 1 en CP 08, liberación de charolas por supervisor en CP 09 |
| D8 | 2026-11-21 | Terminología: **OT** en lugar de WO y **TEP** en lugar de WIP | Aceptada | Estándar del proyecto |
| D9 | 2026-11-21 | Los nodos hablan LoRa con el gateway y un **puente traduce a MQTT**; REST, JSON y la integración con ERP/WMS van del servidor hacia arriba | Aceptada | LoRa no soporta REST/WebSocket/TLS; MQTT desacopla el radio del backend |
| D10 | 2026-11-21 | Prueba de concepto con **LoRa punto a punto + puente propio**; evaluar **LoRaWAN + ChirpStack** para producción | Propuesta | Bajo costo para probar; mismo formato de mensaje y tópicos para migrar sin tocar el backend |
| D11 | 2026-11-21 | SM1 (pantalla AV) y la cámara de CP 15 usan un **equipo local**; por LoRa solo viajan los eventos y resultados | Propuesta | La pantalla gráfica y el video no caben en el ancho de banda de LoRa |
| D12 | 2026-11-21 | Construir un **simulador** con la arquitectura real (protocolo, puente, MQTT, MES) antes del hardware | Aceptada | Permite probar protocolo, gates, capacidad del canal y genealogía; el puente y el MES se reutilizan |
| D13 | 2026-11-21 | Gates en dos niveles: **local en el nodo** y **central en el MES** con conciliación de eventos atrasados | Propuesta | Algunos gates dependen de otra estación y los eventos pueden llegar desordenados por el búfer |
| D14 | 2026-11-21 | **3 líneas de producción:** L1 con 22, L2 con 20 y L3 con 9 inyectoras (51). MP, mezanina, SM1, PT y embarque son **compartidos** | Aceptada | Información de la planta |
| D15 | 2026-11-21 | Nombres `L1-INY-01`…; ID de nodo = línea × 100 + número; estaciones compartidas en el 900 | Aceptada | Con 51 máquinas los ID 30–51 de las estaciones chocaban con las inyectoras; así la línea se lee en el número |
| D16 | 2026-11-21 | **Un solo gateway multicanal**: un canal por línea, otro para MP/mezanina/PT/cámara y dos para las mesas de SM1 | Propuesta | Separa el tráfico de cada línea; en simulación las colisiones bajan de ~19 % a ~8 %. Requiere gateway de 8 canales (SX1302), no una Heltec sola |
| D17 | 2026-11-21 | Capacidad de estaciones compartidas en la simulación: 3 operadores de resina, 4 mesas SM1, 2 puestos de paletizado | Supuesto | Con 1 operador, 2 mesas y 1 puesto, 51 máquinas se quedaban esperando resina y la fila de pre-envío crecía. Validar con la planta (pregunta 9) |
| D18 | 2026-11-24 | **El MES decide el voceo** y publica en `aseti/p1/voceo` qué MP3 tocar; el servidor del conmutador solo reproduce | Propuesta | Solo el MES sabe si un evento llegó atrasado, si ya se voceó o si la máquina sigue bloqueada. Así el servidor del conmutador no lleva lógica de planta |
| D19 | 2026-11-24 | Colores de estado, nombres, colores de CP y reglas del voceo se configuran desde el panel y se guardan en el servidor (`datos/ajustes.json`) | Aceptada | El cliente tiene su propio código de colores y todavía no lo entrega; así se cambia sin tocar código y lo ven todos los paneles |
| D20 | 2026-11-24 | Soporte ASETI con **diagnóstico y acciones fijas protegidas con clave**, no un acceso que ejecute comandos libres | Aceptada | Una página que corre cualquier comando es la misma entrada que usaría un intruso. Las acciones fijas cubren el soporte diario y quedan auditadas |


---

# 04 · Bitácora

> **Última actualización:** 2026-11-24
> Lo más reciente va arriba.

## 2026-11-24 (pruebas automáticas)

**Hecho**
- 70 pruebas en `simulador/test/` con `node --test` (`npm test`, unos 2 s): protocolo LoRa, gate local de cada terminal, MES, voceo, catálogo de avisos, configuración, mantenimiento y una prueba de punta a punta con broker MQTT real.
- GitHub Actions corre las pruebas en cada push a `main` (`.github/workflows/pruebas.yml`).

**Pendiente**
- El panel web no tiene pruebas automáticas.

## 2026-11-24 (voceo por conmutador)

**Hecho**
- Carpeta `voceo/`: catálogo de avisos (8 roles × inyectoras y estaciones, más 13 avisos generales; 412 en total) y `generar.mjs` para crear los MP3 con ElevenLabs. Opción `--muestra` con 53 avisos.
- MES: módulo `src/mes/voceo.js`. Decide qué alertas se anuncian y a quién se llama, y publica en `aseti/p1/voceo` para el servidor del conmutador (Fanvil). Reglas: solo códigos de la tabla, no vocea eventos atrasados más de 2 min, no repite el mismo llamado antes de 5 min, y vuelve a vocear si la máquina sigue bloqueada a los 5 y 10 min (D18).
- Panel: sección «Voceo por conmutador». El navegador hace de conmutador de prueba (timbre + MP3, o voz del navegador si falta el MP3), botón «Vocear ahora» y la lista de lo que se voceó, lo que no y por qué. El menú de fallas dice a quién vocea cada una.

- Voz elegida: Ana María (mexicana, ElevenLabs). Generados los 53 avisos de la muestra.
- Panel: pestaña **Configuración** (colores de estado del cliente en RGB o hex, nombres de estado, nombre de planta, color de barra, colores de CP, tiempos y tabla de qué alerta llama a quién). Se guarda en `datos/ajustes.json` y se aplica en vivo en todos los paneles.
- **Mantenimiento ASETI** en `/aseti.html`: con clave (`ASETI_TOKEN` o `datos/aseti-token.txt`), bloqueo tras 5 intentos, diagnóstico, acciones fijas (integridad, respaldo, WAL, desbloquear terminales, señal, fallas, prueba de voceo, restablecer configuración) y auditoría en `datos/auditoria.log`. No ejecuta comandos arbitrarios.
- Docker: volumen `trazabilidad_datos` para no perder ajustes, clave y auditoría.
- Se integraron los 3 commits del 2026-11-23 que estaban en GitHub y no en esta copia (placa ESP32, recorrido guiado, barra de paros, índices). Los tonos de la barra de paros y del recorrido ahora salen de los colores de estado.

**Pendiente**
- Que el cliente pase sus colores y los cargue en Configuración.
- Decidir si la pestaña Configuración también pide clave en el VPS.
- Generar los 412 avisos completos (hace falta plan Starter de ElevenLabs) y convertirlos a 8 kHz si el conmutador lo pide.
- Antes de trabajar, `git pull`: hay cambios que llegan desde otras herramientas.
- Confirmar con la planta qué alerta llama a quién (tabla en `docs/05`, sección 5.1) y el formato de audio que acepta el conmutador.

## 2026-11-23 (terminal ESP32 y recorrido guiado)

**Hecho**
- La pestaña Terminal ahora dibuja la placa ESP32 LoRa (pantalla OLED con línea de señal y memoria, LED de transmisión, antena), el QR fijo de cada máquina, el lector GM65 y la báscula.
- Nuevo modo **Recorrido guiado de una OT**: un botón Siguiente lleva la OT de la solicitud al despacho, muestra cómo se genera (CP 01–05 y ficha de la OT) y sigue la OT por la planta hasta CP 16. El paso actual se deduce del estado real de la máquina.
- **Mostrar un error** en el recorrido: gafete no habilitado, carpeta de otra máquina, QR vecino (bloqueo y supervisor), bolsa fuera de peso, etiqueta saltada, etiqueta de otra OT (rechazo) y corte de señal LoRa.
- El modo anterior queda como **Modo libre y misiones**, sin cambios.
- `/api/manual/etiquetas` devuelve además fase, si la OT está solicitada, si la máquina arrancó, la bolsa siguiente, el total, bolsas por charola y el QR.
- Manual de usuario, sección 5, reescrita.
- **Barra de paros en vivo** bajo las pestañas: máquinas detenidas, rechazos recientes y nodos sin señal, con su CP, causa, tiempo y accesos a la planta y a la terminal. El CP y la máquina del paro se marcan en rojo.
- Las fallas del recorrido se presentan como tarjetas con su efecto (detiene la máquina, rechaza la bolsa, guarda en memoria).

**Pendiente**
- Hacer que el QR dibujado sea un QR legible con el teléfono.

## 2026-11-21 (tres líneas)

**Hecho**
- La planta simulada ahora tiene 3 líneas: L1 con 22, L2 con 20 y L3 con 9 inyectoras (51), con estaciones compartidas. Máquinas `L1-INY-01`…, ID de nodo = línea × 100 + número, estaciones en el 900 (D14, D15).
- Radio: un gateway multicanal; cada línea en su canal, estaciones compartidas en otro y las mesas de SM1 en dos más (D16). El panel muestra la ocupación de cada canal y la columna Canal en el aire LoRa.
- Planta: se prende y apaga cada línea (una o varias) y se elige ver **Resumen** (una luz por máquina) o **Tarjetas**. Al seguir una OT de una línea apagada, se prende. Menús agrupados por línea.
- Capacidad de estaciones compartidas ajustada para 51 máquinas: 3 operadores de resina, 4 mesas SM1, 2 puestos PT (D17, supuesto).

**Pendiente**
- Confirmar con la planta cuántos operadores de resina, mesas de SM1 y puestos de paletizado hay (pregunta 9 de `01_CONTEXTO.md`).
- Elegir el gateway de 8 canales para producción (D16).

## 2026-11-21 (seguimiento de OT y tiempos)

**Hecho**
- Seguir una OT: cada estación resaltada muestra qué CP hizo con esa OT (las estaciones de la derecha son compartidas y antes parecía que eran de otra orden). La barra dice en palabras dónde va la OT y qué espera.
- Cuello de botella en pre-envío corregido en la simulación: el armado de tarima (CP 14) y la cámara (CP 15) tardaban más que el ritmo con que la planta termina OT, y la fila de cajas en CP 13 crecía sin fin. Con los tiempos nuevos la fila se mantiene en 2–5 OT.
- Pedir OT nueva en modo manual: tras la última bolsa había que esperar ~400 s simulados (inspección y retiro de charolas a ritmo de planta). Ahora la máquina manual tiene prioridad también en CP 08–10, al cierre y en almacén MP: ~40–60 s simulados.

## 2026-11-21 (cierre)

**Hecho**
- Pestaña Terminal del simulador rehecha para aprender jugando: 7 misiones guiadas que se marcan solas, animación del viaje de cada mensaje (terminal → aire LoRa → gateway → puente → MQTT → MES → ACK) con explicación en lenguaje simple, memoria de la terminal visible, botón para cortar y restablecer la señal, y estado en vivo de cada escaneo.
- La máquina en modo manual tiene prioridad en la mezanina (antes esperaba la fila de las automáticas).
- `05_DOCUMENTACION_TECNICA.md`: protocolo byte por byte, tópicos y JSON de MQTT, gates por CP, esquema SQL, API, configuración y pasos para cambiar lo simulado por hardware.
- `06_MANUAL_USUARIO.md`: guía del panel para personal de planta.

**Pendiente**
- Rehacer el prototipo `referencias/panel_simulado_v0.html` con datos reales del simulador. El prototipo menciona Redis, FastAPI y MySQL con cifras de ejemplo que no corresponden a la arquitectura LoRa vigente.

## 2026-11-21 (noche)

**Hecho**
- Simulador completo en `simulador/` (Node.js): 28 nodos (22 inyectoras, MP, mezanina, 2 mesas SM1, PT, visión), canal LoRa simulado, puente LoRa → MQTT real, broker MQTT, MES con genealogía en SQL y panel web.
- Protocolo binario v1 definido en `simulador/src/protocolo/trama.js` (base para el firmware).
- Prueba de 80 min de planta: 16 OT completas, 16 tarimas despachadas, todas las fallas programadas detectadas.

**Hallazgos**
- Un solo canal LoRa con 28 nodos: ~8 % de ocupación y ~12 % de colisiones; los reintentos y la deduplicación las absorben.
- SM1 con una sola mesa se satura con 22 inyectoras (supuesto: 1 bolsa cada 90 s por máquina).
- Hay gates que no se pueden validar en el nodo (CP 11 necesita saber si hubo CP 10 en otra estación): se resuelven en el MES con conciliación de eventos atrasados.

**Pendiente**
- Validar con la planta: ritmo real de bolsas por máquina, bolsas por caja, número de mesas en SM1.
- Portar la lógica del nodo y el protocolo al firmware del ESP32; cambiar el canal simulado por el puerto serie del gateway.

## 2026-11-21 (tarde)

**Hecho**
- Se recibe el contexto actualizado del proyecto: flujo de 16 CP con gates, datos y destino si falla; arquitectura en 4 capas; convenciones OT/TEP y código de colores por rol.
- `01_CONTEXTO.md` reescrito con el flujo vigente; el orden anterior de CP 07–10 queda marcado como DESCARTADO.
- `02_ARQUITECTURA.md` actualizado: puente LoRa → MQTT, tópicos, formato de mensaje, reglas de entrega y estaciones especiales (SM1, cámara de CP 15).
- Decisiones D7–D11.

**Pendiente**
- Conseguir los archivos mencionados en el contexto (`Matriz_Trazabilidad_Inyeccion_Plastico_v2.xlsx`, `.json` y el tablero HTML) y guardarlos en `referencias/`.
- Preguntas abiertas nuevas: ERP/WMS, red en SM1 y pre-envío, básculas, bolsas por caja y cajas por tarima.
- Prueba de concepto de CP 06 de punta a punta hasta MQTT.

## 2026-11-21 (mañana)

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


---

# 05 · Documentación técnica

> **Última actualización:** 2026-11-24
> **Aplica a:** simulador v0.1 (`simulador/`) y al diseño del sistema real que lo reemplaza pieza por pieza.
> **Público:** quien programe el firmware, el servidor o la integración con ERP/WMS.

## 1. Propósito

El sistema valida con escaneos cada checkpoint (CP 01–CP 16) de la planta de inyección y guarda la genealogía completa: **lote de resina → OT → bolsa → caja → tarima → embarque**. La comunicación de piso es por LoRa (no se puede cablear y el WiFi tiene interferencia) y se traduce a MQTT en el servidor.

El simulador implementa esa arquitectura completa en software. Las piezas del servidor (puente, broker, MES, base de datos, panel) son las que se usarán en planta; las piezas de campo (terminal, radio, lector, báscula) están simuladas y se reemplazan por hardware.

## 2. Arquitectura

```
 CAMPO                       EDGE (terminal por estación)          SERVIDOR EN PLANTA                         EMPRESA
 Lector QR/barras ──UART──►  ESP32 + LoRa (Heltec LoRa32)          Gateway LoRa ──USB──► Puente LoRa↔MQTT     ERP
 Báscula ─────────RS-232──►  · gate local (responde al instante)          ▲                    │               WMS
 Andon / buzzer ◄──────────  · memoria de eventos (búfer)               LoRa                   ▼
                             · reloj sincronizado por ACK            915 MHz            Broker MQTT
                                         │                              │                    │
                                         └──────────── radio ───────────┘              MES + SQL ──► panel web
```

| Pieza | Archivo del simulador | En planta | Se reutiliza |
|---|---|---|---|
| Protocolo binario v1 | `src/protocolo/trama.js` | Firmware y puente | Sí: es la especificación |
| Gate local por estación | `src/nodo/nodo.js`, `src/nodo/estaciones.js` | Firmware ESP32 (C++) | Se traduce la lógica |
| Radio LoRa | `src/radio/canal-lora.js` | SX1276/SX1262 | No: se reemplaza por el puerto serie del gateway |
| Puente LoRa ↔ MQTT | `src/puente/puente-lora-mqtt.js` | Servidor | Sí |
| Broker MQTT | Aedes embebido (`src/index.js`) | Mosquitto | Mismos tópicos |
| MES y gates centrales | `src/mes/mes.js` | Servidor | Sí |
| Base de datos | `sql/esquema.sql` (SQLite) | MySQL o PostgreSQL | Esquema portable |
| Panel web | `src/web/servidor.js`, `public/` | Servidor | Sí |
| Personas en planta | `src/sim/simulacion.js` | Operadores reales | No |

### Principio de diseño: dos niveles de gate

1. **Gate local (en la terminal).** Responde PASS/FAIL al instante aunque no haya señal. La terminal tiene en memoria lo que necesita (OT activa, operadores habilitados, peso nominal y tolerancia, siguiente correlativo), que el MES le carga por LoRa en CP 05.
2. **Gate central (en el MES).** Para reglas que dependen de otra estación; por ejemplo, en CP 11 la mesa de SM1 no puede saber si la charola pasó por CP 10 en la inyectora. Como los eventos de nodos distintos pueden llegar desordenados (uno pudo estar sin señal), el MES deja la regla **pendiente** y la concilia cuando llega el evento atrasado. Si no llega en 10 minutos, genera una alerta roja `GATE_PREVIO_NO_PASS`.

## 3. Protocolo LoRa v1

Todas las tramas siguen este formato. Enteros en *big endian*.

```
┌──────────┬──────────┬──────────┬─────────────────────┬──────────┐
│ byte 0   │ bytes 1-2│ bytes 3-4│ cuerpo (según tipo) │ 4 bytes  │
│ ver|tipo │ id nodo  │ seq      │                     │ firma    │
└──────────┴──────────┴──────────┴─────────────────────┴──────────┘
```

- **byte 0:** versión en los 4 bits altos (hoy `1`), tipo en los 4 bits bajos.
- **id nodo:** `uint16`. Inyectoras = línea × 100 + número (L1-INY-01 = 101, L2-INY-20 = 220, L3-INY-09 = 309). Estaciones compartidas: MP 901, mezanina 902, SM1 911–914, PT 921–922, visión 931.
- **seq:** `uint16`, contador propio de cada nodo; identifica el mensaje para el ACK y para eliminar duplicados.
- **firma:** primeros 4 bytes de `HMAC-SHA256(clave_del_nodo, cabecera + cuerpo)`. La clave del nodo es `HMAC-SHA256(clave_de_red, "nodo:<id>")`. Una trama con firma inválida se descarta y se publica en `.../gateway/rechazo`.

### 3.1 Tipos de mensaje

| Tipo | Valor | Sentido | Cuerpo |
|---|---|---|---|
| EVENTO | 1 | nodo → gateway | `cp u8`, `resultado u8`, `ts u32` (epoch s), campos TLV |
| ESTADO | 2 | nodo → gateway | `ts u32`, `búfer u16`, `bloqueado u8`, campos TLV |
| ACK | 3 | gateway → nodo | `seq confirmado u16`, `ts u32` (hora del servidor, para sincronizar) |
| CMD | 4 | gateway → nodo | `código u8`, campos TLV |
| CMD_ACK | 5 | nodo → gateway | `seq del comando u16`, `resultado u8` |

### 3.2 Campos variables (TLV)

Cada campo es `[etiqueta u8][largo u8][valor]`. Un receptor ignora etiquetas que no conoce (compatibilidad hacia adelante).

| Etiqueta | Campo | Tipo | Etiqueta | Campo | Tipo |
|---|---|---|---|---|---|
| 1 | ot | texto | 15 | ubicacion | texto |
| 2 | operador | texto | 16 | puerta | texto |
| 3 | maquina | texto | 17 | cantidad | u16 |
| 4 | lote | texto | 18 | charola | u8 |
| 5 | bolsa | u16 | 19 | defecto | u8 |
| 6 | total | u16 | 20 | pesoNominal | u16 |
| 7 | peso (g) | u16 | 21 | tolerancia | u16 |
| 8 | caja | texto | 22 | operadores | lista separada por comas |
| 9 | posicion | u8 | 23 | skuProducto | texto |
| 10 | skuResina | texto | 24 | orden | texto |
| 11 | embudo | texto | 25 | numeroParte | texto |
| 12 | tarima | texto | 26 | proveedor | texto |
| 13 | cara | u8 | 27 | cierre | u8 |
| 14 | camara | u8 | | | |

### 3.3 Resultados (byte `resultado`)

| Código | Nombre | Código | Nombre |
|---|---|---|---|
| 0 | PASS | 10 | DEFECTO_CRITICO |
| 1 | CERTIFICADO_INVALIDO | 11 | BOLSA_OTRA_OT |
| 2 | GATE_PREVIO_NO_PASS | 12 | DUPLICADO |
| 3 | RESINA_INCORRECTA | 13 | CAJA_LLENA |
| 4 | OT_NO_ASIGNADA | 14 | CAJA_INCOMPLETA |
| 5 | OPERADOR_NO_HABILITADO | 15 | CAJA_SIN_ENCINTAR |
| 6 | QR_MAQUINA_INCORRECTO | 16 | SKU_NO_COINCIDE |
| 7 | NODO_BLOQUEADO | 17 | TARIMA_INCOMPLETA |
| 8 | PESO_FUERA_TOLERANCIA | 18 | CAMARA_NO_CONFIRMA |
| 9 | SECUENCIA_ROTA | | |

### 3.4 Comandos (byte `código` de CMD)

| Código | Comando | Destino | Datos |
|---|---|---|---|
| 1 | CARGAR_OT | inyectora | ot, skuProducto, total, pesoNominal, tolerancia, operadores |
| 2 | DESBLOQUEAR | inyectora | — |
| 3 | FIN_OT | inyectora | ot |
| 4 | CARGAR_FORMULA | mezanina | ot, skuResina |

### 3.5 Ejemplo: bolsa 1 de 12 (CP 07), 47 bytes

```
11 00 70 00 0a 07 00 6b 02 26 85 01 0b 4f 54 2d 32 36 31 31 2d 30 31 38 05 02 00 01 06 02 00 0c 07 02 09 60 02 05 45 31 30 33 34 xx xx xx xx
│  │     │     │  │  │           │                                   │           │           │           │                       └ firma
│  │     │     │  │  │           └ ot = "OT-2611-018"                └ bolsa = 1 └ total = 12└ peso = 2400 g          └ operador = "E1034"
│  │     │     │  │  └ ts
│  │     │     │  └ resultado 0 = PASS
│  │     │     └ cp = 7
│  │     └ seq = 10
│  └ nodo = 112 (L1-INY-12)
└ versión 1, tipo 1 (EVENTO)
```

Tiempo en aire con SF7 / 125 kHz / CR 4/5: **~92 ms** para 47 bytes y **~46 ms** para un ACK de 15 bytes (fórmula de Semtech AN1200.13, implementada en `tiempoEnAire()`).

## 4. Reglas de entrega

| Parámetro | Valor | Dónde |
|---|---|---|
| Espera del ACK | 2.5 s | `config.js → nodo.esperaAckMs` |
| Intentos antes de "sin enlace" | 4 (espera aleatoria 0.3–1.5 s × intento) | `nodo.maxIntentos` |
| Reintento sin enlace | cada ~20 s | `nodo.reintentoLargoMs` |
| Capacidad de la memoria (búfer) | 500 eventos; si se llena, se descarta el más viejo y se cuenta | `nodo.capacidadBufer` |
| Latido de estado | cada ~120 s, sin ACK | `nodo.latidoMs` |
| Reintentos de comando (gateway) | 5 intentos cada 3–4.5 s; luego `SIN_RESPUESTA` | `puente-lora-mqtt.js` |

1. El nodo transmite **un evento a la vez**, en orden (FIFO). Así los eventos de un mismo nodo nunca llegan desordenados.
2. El puente publica en MQTT con QoS 1 y **solo después** envía el ACK. Si el ACK se pierde, el nodo reenvía y el MES descarta la copia por `UNIQUE(nodo, seq)`.
3. Cada ACK trae la hora del servidor; el nodo ajusta su reloj con ella.
4. El puente marca `diferido: true` cuando la hora del nodo y la del gateway difieren más de 15 s (el evento salió de la memoria después de una desconexión).
5. Los comandos son idempotentes: si el `CMD_ACK` se pierde y el gateway reintenta, el nodo no ejecuta el comando dos veces (recuerda los últimos 50 `seq` de comando).

## 5. MQTT

Prefijo configurable; por defecto `aseti/p1`.

| Tópico | Publica | QoS | Contenido |
|---|---|---|---|
| `aseti/p1/nodo/{nodo}/evento` | puente | 1 | Evento de checkpoint |
| `aseti/p1/nodo/{nodo}/estado` | puente | 0, retenido | Latido: búfer, bloqueo, RSSI, OT cargada |
| `aseti/p1/nodo/{nodo}/cmd` | MES | 1 | Comando para la terminal |
| `aseti/p1/nodo/{nodo}/cmd_ack` | puente | 1 | Respuesta de la terminal o `SIN_RESPUESTA` |
| `aseti/p1/mes/evento` | MES | 0 | Acciones de oficina (CP 03, CP 05) |
| `aseti/p1/alerta` | MES | 0 | Alertas de gate local o central |
| `aseti/p1/voceo` | MES | 1 | Aviso que el conmutador debe reproducir (ver 5.1) |
| `aseti/p1/erp/despacho` | MES | 1 | Cierre de trazabilidad en CP 16 |
| `aseti/p1/gateway/traza` | puente | 0 | Trama en hex + JSON traducido (diagnóstico) |
| `aseti/p1/gateway/rechazo` | puente | 0 | Tramas con firma inválida o nodo desconocido |

**Evento** (`.../nodo/L1-INY-12/evento`):

```json
{
  "nodo": "L1-INY-12", "nodo_id": 112, "seq": 10, "cp": 7,
  "resultado": "PASS", "codigo": "PASS",
  "ts_nodo": "2026-11-21T23:10:46.000Z", "ts_gateway": "2026-11-21T23:10:46.000Z",
  "diferido": false, "rssi": -79, "snr": 8.2,
  "datos": { "ot": "OT-2611-018", "bolsa": 1, "total": 12, "peso": 2400, "operador": "E1034" }
}
```

**Comando** (`.../nodo/L1-INY-12/cmd`):

```json
{ "id": "6f1c…", "cmd": "CARGAR_OT", "datos": { "ot": "OT-2611-018", "skuProducto": "CONT-500-PE", "total": 12, "pesoNominal": 2400, "tolerancia": 40, "operadores": ["E1034", "E1035", "E1036"] } }
```

**Despacho al ERP** (`.../erp/despacho`):

```json
{ "tarima": "TR-0003", "orden_embarque": "OE-2611-003", "numero_parte": "TAP-28-PP", "puerta": "P-4",
  "cajas": ["CJ-000007", "CJ-000009", "CJ-000012"], "ots": ["OT-2611-004"], "estatus_trazabilidad": "COMPLETO", "ts_salida": "…" }
```

### 5.1 Voceo por conmutador

El módulo `src/mes/voceo.js` escucha `alerta`, `nodo/+/evento` y `nodo/+/cmd_ack`, y publica en `voceo` el aviso que hay que tocar en los Fanvil. Los textos y MP3 salen de la carpeta `voceo/` (`VOCEO_DIR` para cambiarla).

```json
{ "id": "9518d3f9-…", "ts": "2026-11-24T16:34:52Z", "rol": "supervisor", "destino": "L2-INY-07",
  "archivo": "supervisor__L2-INY-07.mp3", "texto": "Supervisor de producción, favor de acudir a línea dos, inyectora siete.",
  "repetir": 2, "escalamiento": 0,
  "alerta": { "codigo": "OPERADOR_NO_HABILITADO", "cp": 6, "nodo": "L2-INY-07", "ot": "OT-2611-018", "nivel": "rojo" } }
```

`escalamiento` es 0 en el primer aviso y 1, 2 cuando se repite porque la máquina sigue bloqueada. `alerta` es `null` en las pruebas manuales desde el panel.

| Código | A quién | Lugar |
|---|---|---|
| `OPERADOR_NO_HABILITADO`, `QR_MAQUINA_INCORRECTO`, `OT_NO_ASIGNADA`, `NODO_BLOQUEADO` | Supervisor (con escalamiento si es CP 06) | La inyectora |
| `DEFECTO_CRITICO` | Calidad | La inyectora |
| `CERTIFICADO_INVALIDO` | Calidad | Materia prima |
| `RESINA_INCORRECTA` | Supervisor | Mezanina |
| `GATE_PREVIO_NO_PASS` | Supervisor | La estación que lo detectó |
| `BOLSA_OTRA_OT`, `DUPLICADO` | Calidad | Mesa de SM1 |
| `SKU_NO_COINCIDE`, `TARIMA_INCOMPLETA` | Supervisor | Puesto PT (la cámara VIS-01 se vocea como embarque) |
| `PESO_FUERA_TOLERANCIA`, `SECUENCIA_ROTA`, `CAJA_SIN_ENCINTAR`, `CAJA_INCOMPLETA`, `CAJA_LLENA`, `CAMARA_NO_CONFIRMA` | No se vocea, solo panel | — |

Reglas: no se vocea un evento atrasado (búfer de la terminal) de más de 2 min; el mismo llamado no se repite antes de 5 min; un bloqueo de CP 06 se vuelve a vocear a los 5 y 10 min si no llega el `cmd_ack` de `DESBLOQUEAR` ni un CP 06 en PASS. Todos los tiempos son simulados (se aceleran con la velocidad del panel). Los tiempos, las repeticiones y qué código llama a quién se cambian en la pestaña Configuración (D19); los de esta tabla son los valores de fábrica.

## 6. Gates por checkpoint

| CP | Estación | Gate local (terminal) | Gate central (MES) |
|---|---|---|---|
| 01 | MP-01 | Certificado válido | — |
| 02 | MP-01 | Lote recibido y aprobado | — |
| 03 | MES | — | Hay resina aprobada del SKU en la mezanina |
| 04 | MEZ-01 | OT cargada; SKU de resina = formulación de la OT | — |
| 05 | MES | — | Existe CP 04 en PASS (espera si viene atrasado) |
| 06 | INY-xx | OT cargada, terminal no bloqueada, operador habilitado, OT correcta, QR de esta máquina | — |
| 07 | INY-xx | Arranque hecho, correlativo siguiente, peso en tolerancia | — |
| 08 | INY-xx | Bolsa registrada; sin defecto crítico | — |
| 09 | INY-xx | Charola inspeccionada | — |
| 10 | INY-xx | Charola liberada | — |
| 11 | SM1-0x | Bolsa de la OT de la caja, sin duplicados, caja no llena | La bolsa pasó CP 10; no está en otra caja |
| 12 | SM1-0x | Caja completa y encintada | — |
| 13 | PT-01 | Caja no ingresada antes | La caja está cerrada (CP 12) |
| 14 | PT-01 | Número de parte = orden de embarque; caja ingresada; cantidad completa al cerrar | La caja está en PT (CP 13) |
| 15 | VIS-01 | La cámara confirma cada cara | La tarima está armada (CP 14) |
| 16 | VIS-01 | 4/4 caras verificadas | Tarima verificada; publica el despacho al ERP |

## 7. Base de datos

Esquema en `simulador/sql/esquema.sql`.

```
lotes_mp ─< cargas_resina >─ ordenes_trabajo ─< bolsas
                                    │              │ (id_bolsa)
                                    └─< cajas ─< caja_bolsas
                                          │
                                     tarimas ─< cajas
eventos  (todo lo que llega, UNIQUE(nodo, seq))
alertas  (gate local o central)
inspecciones_tep
```

- `caja_bolsas` **no** tiene llave foránea hacia `bolsas` a propósito: el evento de SM1 puede llegar antes que el de la inyectora. La conciliación del MES completa el estado después.
- `eventos.ref` guarda el identificador principal del evento (bolsa, caja, tarima o lote) para consultas rápidas.

Consulta de genealogía hacia atrás desde una caja:

```sql
SELECT c.id_caja, cb.posicion, b.id_bolsa, b.peso_g, o.ot, o.id_maquina, cr.id_lote, l.proveedor
FROM cajas c
JOIN caja_bolsas cb ON cb.id_caja = c.id_caja
LEFT JOIN bolsas b ON b.id_bolsa = cb.id_bolsa
JOIN ordenes_trabajo o ON o.ot = c.ot
LEFT JOIN cargas_resina cr ON cr.ot = o.ot AND cr.resultado = 'PASS'
LEFT JOIN lotes_mp l ON l.id_lote = cr.id_lote
WHERE c.id_caja = 'CJ-000003'
ORDER BY cb.posicion;
```

## 8. API HTTP del panel

| Método y ruta | Uso |
|---|---|
| `GET /api/stream` | Flujo SSE: `inicio` (incluye catálogo de avisos y ajustes), `estado` (cada 0.8 s), `aire`, `traza`, `mqtt`, `mes`, `ajustes` (cuando alguien guarda la configuración) |
| `GET /api/genealogia?id=` | Genealogía y eventos de una OT, bolsa, caja, tarima o lote |
| `POST /api/control` | `velocidad`, `perdida`, `intervalo`, `falla`, `sinSenal`, `conSenal`, `probarVoceo` (`clave` del aviso) |
| `GET /api/manual/etiquetas?maquina=` | Estado de la terminal manual y etiquetas disponibles |
| `POST /api/manual` | `tomar`, `soltar`, `pedirOT`, `escanear`, `pesar`, `desbloquear` |
| `GET /voceo/{archivo}.mp3` | Audio del voceo desde `voceo/salida/` (solo nombres `[A-Za-z0-9_-]+.mp3`) |
| `GET /api/ajustes` · `PUT /api/ajustes` | Lee o guarda la configuración (`datos/ajustes.json`). El servidor parte de los valores de fábrica y descarta lo inválido: colores que no son `#rrggbb`, números fuera de rango, roles sin avisos |
| `GET /api/aseti/diagnostico` | Diagnóstico completo (pide clave) |
| `GET /api/aseti/diagnostico.json` | El mismo diagnóstico como archivo descargable |
| `GET /api/aseti/acciones` | Acciones disponibles y las últimas 30 del registro de auditoría |
| `POST /api/aseti/accion` | `{ "id": "bd_respaldo" }`: corre una acción de la lista fija |

Todas las rutas `/api/aseti/*` piden `Authorization: Bearer <clave>`. Responden 401 con clave mala y 429 después de 5 intentos fallidos en un minuto desde la misma IP (bloqueo de 1 minuto). Las acciones se registran en `datos/auditoria.log` (JSON por línea). Para agregar una acción se añade una entrada en `ACCIONES` de `src/aseti/mantenimiento.js`; a propósito no existe una acción que ejecute comandos del sistema (D20).

## 9. Configuración y ejecución

```bash
cd simulador
npm install
npm start                 # panel :8080, MQTT :1883
npm run prueba -- 120     # 120 s sin panel a 40x, con fallas programadas
npm test                  # pruebas automáticas (70, unos 2 s)
```

**Pruebas automáticas.** `simulador/test/` tiene pruebas con `node --test` para el protocolo, los gates de cada terminal, el MES (duplicados y conciliación), el voceo, el catálogo de avisos, la configuración, el mantenimiento y una prueba de punta a punta con broker MQTT real en un puerto libre. GitHub Actions las corre en cada push y pull request (`.github/workflows/pruebas.yml`, Node 22). El detalle por archivo está en `simulador/README.md`. El panel web (HTML y JS del navegador) no tiene pruebas automáticas: se revisa a mano.

| Variable | Por defecto | Efecto |
|---|---|---|
| `PUERTO_HTTP` | 8080 | Puerto del panel |
| `PUERTO_MQTT` | 1883 | Puerto del broker |
| `PREFIJO_MQTT` | `aseti/p1` | Prefijo de tópicos |
| `VELOCIDAD` | 10 | Factor de tiempo (1 = real) |
| `LINEAS` | `22,20,9` | Inyectoras por línea, separadas por coma |
| `INYECTORAS` | — | Atajo: una sola línea con ese número de inyectoras |
| `OPERADORES_RESINA` | 3 | Cargas de resina en paralelo en la mezanina (CP 04) |
| `MESAS_SM1` | 4 | Mesas de empaque en SM1 (CP 11–12), una terminal por mesa |
| `PUESTOS_PT` | 2 | Puestos de paletizado en PT (CP 14), una terminal por puesto |
| `BOLSAS_OT` | 12 | Bolsas por OT (múltiplo de 4) |
| `INTERVALO_BOLSA` | 90000 | ms simulados entre bolsas por máquina |
| `PERDIDA` | 0.02 | Probabilidad base de perder una trama por ruido |
| `TASA_FALLAS` | 0 | Fallas aleatorias además de las programadas |
| `CLAVE_RED` | valor de demostración | Clave para firmar tramas |
| `ASETI_TOKEN` | se genera en `datos/aseti-token.txt` | Clave de la página de mantenimiento |
| `VOCEO_DIR` | `../voceo` | Carpeta con el catálogo y los MP3 del voceo |

Archivos que el servidor guarda en `datos/` (no van a git): la base `trazabilidad.db` (se reinicia en cada arranque), `ajustes.json`, `aseti-token.txt`, `auditoria.log` y `respaldos/`. En Docker, `datos/` es el volumen `trazabilidad_datos`.

Requiere Node.js 22.13 o superior (`node:sqlite`).

## 10. Resultados de prueba

Prueba sin panel de 120 s a 40× (≈ 80 min de planta), 28 nodos, fallas programadas:

| Medida | Valor |
|---|---|
| OT completas / tarimas despachadas | 16 / 16 |
| Ocupación del canal | ~8 % |
| Tramas con colisión | ~12 % (absorbidas por reintentos) |
| Eventos perdidos | 0 |
| Fallas programadas detectadas | 8 de 8, incluida una charola sin CP 10 (gate central) |

Hallazgo de capacidad: con una sola mesa en SM1 la estación se satura (supuesto: 1 bolsa cada 90 s por máquina). La simulación usa dos mesas. Hay que confirmar el ritmo real con la planta.

**Con 3 líneas (51 inyectoras, 2026-11-21).** Tres corridas del panel a 40×:

| Corrida | OT esperando resina | Tarimas por hora de planta | Canal más ocupado | Tramas con colisión |
|---|---|---|---|---|
| 1 operador de resina, 2 mesas SM1, 1 puesto PT (~1 h de planta) | 33–42 | ~15 | — | ~5 % |
| 3 operadores, 4 mesas, 2 puestos; estaciones en un solo canal (~5 h) | 4–16 | ~45 | 24 % (estaciones) | ~19 % |
| Igual, con las mesas de SM1 en dos canales propios (~3 h) | 2–12 | ~45 | ~10 % | ~8 % |

Los números de operadores, mesas y puestos son supuestos (D17).

## 11. Paso a hardware

1. **Firmware de la terminal (ESP32):** portar `Nodo` (seq, cola FIFO en flash, ACK, reintentos, reloj) y la clase de su estación (`NodoInyectora`, etc.). Codificar y decodificar con el formato de la sección 3. El método `escanear()` de `NodoInyectora` ya separa los códigos por formato como lo haría el firmware.
2. **Lector:** módulo con salida UART (GM65/GM67). Cada lectura termina en `\r`; equivale a `escanear(codigo)`.
3. **Báscula:** lectura estable por RS-232 (convertidor a TTL); equivale a `pesar(gramos)`.
4. **Gateway:** una Heltec LoRa32 que reenvía por USB serie cada trama recibida (con RSSI y SNR) y transmite lo que recibe por serie. En el servidor, reemplazar `CanalLoRa` por un lector de puerto serie que llame a `puente.recibir(buf, meta)` y que implemente `transmitir('gw', buf, nodoId)`.
5. **Broker:** cambiar Aedes por Mosquitto; los tópicos no cambian.
6. **Base de datos:** el esquema es SQL estándar; en MySQL cambiar `INTEGER PRIMARY KEY AUTOINCREMENT` por `INT AUTO_INCREMENT` y `json_extract` por la función equivalente.
7. **Claves:** provisionar una clave distinta por nodo en lugar de derivarla de una clave de red compartida.

## 12. Limitaciones conocidas

- `seq` es de 16 bits: después de 65 535 eventos de un mismo nodo se repite y chocaría con `UNIQUE(nodo, seq)`. En producción agregar un contador de arranques o una ventana de tiempo a la llave.
- El canal simulado no modela el *capture effect* (cuando una trama más fuerte sobrevive a una colisión); el resultado real será algo mejor.
- La firma de 4 bytes detecta alteraciones y tramas ajenas, pero no evita que se reenvíe una trama vieja (*replay*). Mitigación prevista: rechazar `ts` fuera de una ventana y `seq` ya vistos.
- El canal simulado supone un gateway de 8 canales que recibe todos a la vez y transmite sin bloquear la recepción. Un gateway real es *half-duplex*: mientras manda un ACK no escucha. Con 51 terminales conviene medirlo en campo (D16). La prueba de concepto con una Heltec como gateway (opción A) tiene un solo canal.
- La pantalla AV de SM1 y la cámara de CP 15 se simulan como nodos LoRa; en planta usarán un equipo local (decisión D11).
- **Voceo en Docker:** `docker-compose.yml` monta `../voceo` en `/voceo` (solo lectura). El catálogo llega con `git pull`; los MP3 no van en git y hay que copiarlos a `voceo/salida/` en el servidor (por ejemplo con `scp`). Sin MP3, el panel usa la voz del navegador.
- **La pestaña Configuración no pide clave**, igual que los demás controles del panel: en un servidor público cualquiera con el enlace puede cambiar colores y reglas del voceo.


---

# 06 · Manual de usuario del simulador

> **Última actualización:** 2026-11-24
> **Para:** supervisores, calidad, operadores y cualquier persona que quiera entender el sistema antes de instalarlo en planta.
> **No necesita** saber programar. Para el detalle técnico vea [05_DOCUMENTACION_TECNICA.md](05_DOCUMENTACION_TECNICA.md).

## 1. ¿Qué es esto?

Es una planta de inyección "de mentira" que funciona igual que funcionará la real: 51 inyectoras en tres líneas (L1: 22, L2: 20, L3: 9) que comparten el almacén de materia prima, la mezanina, cuatro mesas de SM1, dos puestos de producto terminado y la cámara de embarque. Cada estación tiene una terminal con lector de códigos que manda sus escaneos por radio (LoRa) a un servidor.

Sirve para:

- Ver cómo se registra cada paso (CP 01 a CP 16) y qué pasa cuando algo sale mal.
- Ser operador: llevar una OT completa con el recorrido guiado, provocar errores y ver el viaje de cada mensaje.
- Rastrear cualquier bolsa, caja o tarima hasta el lote de resina.

Nada de lo que haga aquí afecta a la planta. Puede provocar todas las fallas que quiera.

## 2. Cómo abrirlo

1. Abra una terminal en la carpeta `simulador` y escriba `npm start`. (La primera vez, antes: `npm install`.)
2. Abra el navegador en **http://localhost:8080**.
3. Para apagarlo, presione `Ctrl + C` en la terminal.

Cada vez que se inicia, la planta empieza vacía. Las primeras bolsas aparecen en unos segundos.

## 3. La pantalla

**Barra superior.** Hora de la planta simulada y cuatro indicadores:

| Indicador | Qué significa | Valor normal |
|---|---|---|
| Canal LoRa más ocupado | Porcentaje del tiempo que alguna terminal está transmitiendo, en el canal más cargado. Cada línea tiene su canal | Menos de 15 % |
| Tramas con colisión | Mensajes que chocaron con otro y se reenviaron | Menos de 20 % |
| Eventos en MES | Escaneos guardados en la base de datos | Sube sin parar |
| Tarimas despachadas | Tarimas que pasaron CP 16 | Sube cada pocos minutos |

**Velocidad.** 10× quiere decir que un minuto de planta dura 6 segundos. Bájela a 1× para verlo en tiempo real.

**Barra de paros.** Justo debajo de las pestañas, visible en todas. En verde dice *Sin paros: el proceso fluye*. Si una máquina se detiene, rechaza algo o se queda sin señal, se pone roja o ámbar con un resumen y una tarjeta por paro: el checkpoint, la máquina, la causa, desde hace cuánto y qué se necesita para seguir. **Ver en planta** lleva a la máquina y resalta su OT; **Abrir su terminal** abre la pestaña Terminal con esa máquina. Las máquinas detenidas y sin señal se quedan hasta que se resuelven; los rechazos se muestran 20 segundos. El CP del paro también se marca en rojo en la línea de checkpoints.

**Línea de checkpoints.** Debajo de las pestañas, los 16 CP en orden. Se iluminan cuando ocurre un escaneo en ese paso.

## 4. Pestaña Planta

**Seguir una OT.** Arriba de las inyectoras. Elija una OT en la lista o haga clic en la tarjeta de una inyectora para seguir la OT que está produciendo. Todo lo que no tiene que ver con esa OT se atenúa y queda resaltado en morado:

- En la línea de checkpoints, los CP por los que ya pasó (rayita morada; roja si hubo falla) y la marca **llegó hasta aquí** en el CP más avanzado. Una OT puede estar en varios CP a la vez: unas bolsas se siguen moldeando mientras otras ya están en caja.
- Las estaciones que la han tocado (materia prima, mezanina, su inyectora, la mesa de SM1, PT, cámara). Las estaciones de la derecha son compartidas: atienden a todas las inyectoras, por eso se resaltan aunque no sean "de" esa máquina. Cada estación resaltada muestra una nota morada con los CP que hizo con esa OT (por ejemplo, `CP 11, 12` en SM1). La que tuvo la última actividad parpadea.
- Sus alertas y sus líneas de la bitácora.
- Un resumen: máquina, producto, bolsas, cajas, tarimas, fallas, hasta qué CP llegó y la última actividad.
- **Ahora:** en palabras, en qué parte va y qué espera. Por ejemplo: "2 de 3 cajas en pre-envío… la tarima se arma cuando estén todas". Una OT se queda en pre-envío (CP 13) hasta que llegan **todas** sus cajas, porque la tarima se arma con la OT completa.

Se actualiza solo cada 2 segundos. **Ver genealogía** abre su árbol completo en la pestaña Trazabilidad; **Dejar de seguir** quita el resaltado.

**Líneas.** Junto al título "Inyectoras" hay dos grupos de botones. El panel recuerda lo que eligió.

- **Líneas:** **Todas**, **Línea 1 · 22**, **Línea 2 · 20** y **Línea 3 · 9**. Cada línea se prende y se apaga con un clic (la palomita ✓ indica que está prendida), así puede ver una sola o varias. Siempre queda al menos una prendida. **Todas** prende las tres. Al lado del título dice qué está viendo, por ejemplo "líneas 2 y 3".
- **Ver como:**
  - **Resumen:** una fila por línea con una luz por máquina, del color de su torreta (con rayas si está sin señal), y cuántas están produciendo, esperando, en falla o sin OT. Pase el mouse sobre una luz para ver la máquina, su OT y lo que dice su pantalla; si hace clic, sigue su OT. **Ver tarjetas** abre solo esa línea en tarjetas.
  - **Tarjetas:** la pantalla completa de cada máquina de las líneas prendidas.

Si sigue una OT de una línea que tiene apagada, el panel la prende. Las estaciones de la derecha siempre se ven, porque las comparten las tres líneas. En los menús de fallas, señal y Terminal, las máquinas vienen agrupadas por línea.

**Inyectoras.** Cada tarjeta es la pantalla de una terminal. El color es el de su torreta Andon:

| Color | Significado |
|---|---|
| Verde | Produciendo, último escaneo correcto |
| Ámbar | Esperando algo (OT, resina, supervisor) o un aviso que no detiene la línea |
| Rojo | Falla: la terminal está bloqueada hasta que llegue el supervisor |
| Gris | Sin OT |

Si una tarjeta dice **sin señal** o muestra un número en **búfer**, la terminal está guardando mensajes en su memoria porque no alcanza al gateway. Los mandará cuando vuelva la señal.

**Estaciones.** Almacén MP, mezanina, las mesas de SM1 (con la pantalla AV de cada una), los puestos de almacén PT y la cámara de embarque. Las comparten las tres líneas.

**Alertas** (debajo de las inyectoras). Cada falla detectada, con la hora, el CP y la estación. "Pendientes" son reglas que el servidor está esperando confirmar porque falta un escaneo de otra estación.

**Provocar una falla** (junto a las alertas). Elija una falla y, si quiere, la inyectora. La falla ocurre en la próxima oportunidad:

| Falla | CP | Qué debería ver |
|---|---|---|
| Certificado de análisis inválido | 01 | Lote a cuarentena; no se usa para ninguna OT |
| Resina incorrecta en el embudo | 04 | La mezanina rechaza la carga; la OT no se libera |
| Operador no habilitado | 06 | Inyectora en rojo hasta que el supervisor la libera |
| QR de otra máquina | 06 | Igual que el anterior |
| Bolsa fuera de tolerancia | 07 | Ámbar; la bolsa se vuelve a pesar |
| Salto en etiqueta correlativa | 07 | Rojo; se exige la etiqueta correcta |
| Defecto crítico en TEP | 08 | La charola queda retenida |
| Charola sin registrar CP 10 | 10 | La caja avanza, pero el servidor levanta una alerta roja a los 10 minutos de planta |
| Bolsa de otra OT en la caja | 11 | La pantalla AV de SM1 la rechaza |
| Bolsa escaneada dos veces | 11 | Rechazo por duplicado |
| Caja sin encintar | 12 | No se puede cerrar la caja |
| Caja de otro número de parte | 14 | No entra a la tarima |
| La cámara no confirma una cara | 15 | Se repite la foto; la tarima no sale hasta tener 4/4 |

En el menú, cada falla dice a quién vocea (por ejemplo *vocea a supervisor a la inyectora*). Las fallas de arranque (CP 06) ocurren cuando esa inyectora arranca su siguiente OT, en unos minutos simulados.

También puede **cortar la señal LoRa** de cualquier nodo por unos minutos, subir la **pérdida por ruido** o cambiar **cada cuánto sale una bolsa** para saturar la planta.

### 4.1 Voceo por conmutador

Debajo de las alertas. Cuando hay una falla que necesita a alguien, el sistema lo llama por altavoz: *"Supervisor de producción, favor de acudir a línea dos, inyectora siete."* En la planta lo reproduce el conmutador en las bocinas Fanvil; en el simulador, **esta computadora hace de conmutador**.

1. Presione **Activar sonido en esta computadora** (el navegador no deja sonar nada sin un clic).
2. Para oír un aviso al momento, elija **Llamar a** y **Lugar** y presione **Vocear ahora**.
3. Para verlo con una falla real, programe *Operador no habilitado* en una inyectora y espere a que arranque.

Suena un timbre y el aviso dos veces. Si ese aviso todavía no tiene grabación, lo dice la voz del navegador y lo avisa en pantalla.

La lista muestra cada aviso: **Voceado**, **No se voceó** (con el motivo) o **Resuelto** (la máquina se desbloqueó). Con **Oír** se repite uno.

| Motivo de "No se voceó" | Qué quiere decir |
|---|---|
| Solo panel | Esa alerta no llama a nadie, por ejemplo una bolsa fuera de peso |
| Ya se voceó hace menos de 5 min | El mismo llamado ya sonó; no se repite para no saturar |
| Llegó con atraso | La terminal estuvo sin señal y el evento llegó tarde; ya no tiene caso vocearlo |

Si una máquina sigue bloqueada, se vuelve a vocear a los 5 y a los 10 minutos (aparece como *Voceado otra vez*). Los tiempos y a quién llama cada alerta se cambian en la pestaña **Configuración**.

## 5. Pestaña Terminal: sea el operador

Aquí usted controla una inyectora. Las demás siguen trabajando solas. Arriba hay dos modos:

- **Recorrido guiado de una OT** (abre por defecto): un botón **Siguiente** lleva una OT de principio a fin. Es el modo para presentar.
- **Modo libre y misiones:** usted escanea a mano y sigue siete misiones. Es el modo para practicar.

Los dos usan la misma terminal y hacen lo mismo que haría el operador. Si cambia de modo a la mitad, la máquina sigue donde iba.

### 5.1 La terminal

A la izquierda está todo lo que se instala junto a la máquina:

- **Torreta:** gris sin OT, ámbar esperando el arranque, verde produciendo, rojo bloqueada.
- **Placa ESP32 LoRa:** es la terminal. Arriba dice qué máquina es y la señal de radio (en dBm). La **pantalla** muestra lo mismo que vería el operador; la última línea dice la señal y cuántos mensajes tiene en memoria. El **LED** parpadea en rojo cuando la placa transmite y en verde cuando le llega una respuesta.
- **Gafete · OT · QR:** se marcan conforme se escanean. Los tres en orden arrancan la máquina (CP 06).
- **QR fijo:** el código pegado en la máquina. Cada máquina tiene el suyo. Se ilumina en verde cuando se escanea.
- **Lector de códigos:** puede escribir un código y presionar Enter, o usar un lector USB real (funciona como teclado). La luz roja del lector se enciende al leer.
- **Báscula:** mueva el deslizador para elegir el peso y presione **Poner bolsa en la báscula**. Después escanee la etiqueta de la bolsa (CP 07).
- **Memoria de la terminal:** cada cuadrito es un mensaje que todavía no recibe confirmación del servidor. Normalmente aparece y desaparece en un segundo. Sin señal, se acumulan.

Botones de arriba:

- **Elegir una máquina libre** (modo guiado): escoge una inyectora sin OT para empezar desde cero.
- **Tomar el control / Regresar a automático:** pausa o reanuda el ciclo automático de la máquina.
- **Pedir OT nueva** (modo libre).
- **Llamar al supervisor:** solo se activa cuando la terminal está bloqueada.
- **Cortar la señal LoRa / Restablecer la señal:** simula que la máquina queda fuera de alcance.

### 5.2 Recorrido guiado de una OT

A la derecha se ven los 9 pasos, la explicación del paso actual y el botón **Siguiente**, que dice exactamente lo que va a hacer (por ejemplo, *Escanear gafete E1142*). El recorrido se fija en el estado real de la máquina: si alguien escanea a mano, sigue desde donde quedó.

Una **OT** (orden de trabajo) es: "haga 12 bolsas de esta pieza en esta máquina".

1. **Tomar la máquina.** Use antes **Elegir una máquina libre** para ver la OT completa desde el principio.
2. **Solicitar la OT.** Planeación la programa (CP 03), el almacén sube la resina (CP 01–02), en la mezanina la vacían en el embudo (CP 04) y el supervisor entrega el **sobre con las etiquetas numeradas** B1 a B12 (CP 05). Los checkpoints se encienden uno por uno y aparece la **ficha de la OT que se generó**: número, máquina, molde, producto, resina, lote, bolsas y peso permitido. Cuando la OT llega por radio a la terminal, presione **Continuar**.
3. **Gafete**, 4. **Carpeta de la OT** y 5. **QR de la máquina.** Al leer el QR, la terminal revisa los tres juntos y, si cuadran, la máquina arranca y la torreta pasa a verde.
6. **Bolsa 1: pesar y etiquetar.** La máquina va soltando piezas en una bolsa. Llena, el operador la pone en la báscula (confirma que trae las piezas correctas), le pega la siguiente etiqueta del sobre y la escanea. Las etiquetas van en orden: no se puede saltar ninguna.
7. **Bolsas 2–4: charola 1.** La **charola** es la bandeja donde se juntan las bolsas junto a la máquina; le caben 4. No es un paso distinto: es repetir el paso 6 hasta juntar 4 bolsas, y el botón lo hace de corrido. Con 4 bolsas, inspección la recoge, revisa una de muestra (CP 08), el supervisor la libera (CP 09) y se lleva a la mesa de empaque SM1 (CP 10). Mientras, la máquina llena la siguiente.
8. **Bolsas 5–12.** Lo mismo: dos charolas más. Con la última bolsa la OT queda completa en la máquina.
9. **Recorre la planta.** Ya no depende de la máquina: las bolsas se meten en cajas (CP 11–12), pasan a pre-envío (CP 13), se arma la tarima (CP 14), la cámara confirma que están todas (CP 15) y se despacha (CP 16). Los checkpoints se encienden solos. **Ver la genealogía completa** abre la pestaña Trazabilidad con esa OT. **Empezar otra OT** reinicia el recorrido.

Las charolas dibujadas debajo de la explicación muestran cuántas bolsas van y cuáles ya salieron a SM1.

### 5.3 Mostrar errores

Debajo del botón Siguiente, **Simular una falla** ofrece las fallas que aplican al paso actual; cada tarjeta dice lo que provoca (*Detiene la máquina*, *Rechaza la bolsa*, *Guarda en memoria*). Cada una hace mal el paso a propósito, aparece al instante en la barra de paros de arriba y explica, en una tarjeta, qué se hizo mal, qué mostró la terminal y cómo se corrige.

| Error | Cuándo aparece | Qué pasa | Cómo se corrige |
|---|---|---|---|
| Gafete no habilitado | Arranque | La terminal se **bloquea**: torreta roja, no acepta más escaneos | **Llamar al supervisor** (el botón Siguiente cambia a eso). Luego se repite el arranque |
| Carpeta de otra máquina | Arranque | Igual: bloqueo | Igual |
| QR de la máquina vecina | Arranque | Igual: bloqueo | Igual |
| Bolsa fuera de peso | Bolsas | La bolsa se **rechaza**; la máquina sigue y el contador no avanza | Siguiente: se vuelve a pesar y se usa la misma etiqueta |
| Saltarse una etiqueta | Bolsas | Rechazo: "salto en la secuencia" | Siguiente: se escanea la etiqueta que tocaba |
| Etiqueta de otra OT | Bolsas | Rechazo: la etiqueta es de otro sobre | Siguiente: se usa la etiqueta de esta OT |
| Cortar la señal LoRa | Arranque y bolsas | La terminal sigue validando; los mensajes se guardan en su memoria | **Devolver la señal LoRa**: reenvía todo en orden, sin perder nada |

Diferencia importante para explicar: un **error de arranque bloquea** la máquina (no debe producir con el operador, la OT o la máquina equivocados); un **error de bolsa solo rechaza esa bolsa** y la producción sigue. En los dos casos el rechazo queda guardado en el MES.

### 5.4 Modo libre: etiquetas y misiones

**Etiquetas a la mano:** haga clic en una para escanearla. Las marcadas en rojo son incorrectas a propósito: un gafete no habilitado, una OT de otra máquina, una etiqueta que se salta una.

**Misiones:** se muestra una misión a la vez. Se marca sola cuando la terminal registra lo que pide: aparece "¡Lograda!" con lo que aprendió y, a los 5 segundos, pasa a la siguiente. Los puntos de arriba muestran el avance (verde = completada); con ellos o con las flechas puede ver cualquier misión. **Ir a la misión pendiente** lo regresa a la que sigue. Son siete:

1. **Arranque la máquina:** gafete, OT y QR.
2. **Registre una bolsa:** pesar y escanear.
3. **Bolsa fuera de peso:** ver el rechazo y corregir.
4. **Etiqueta fuera de orden:** el correlativo no se puede saltar.
5. **Trabaje sin señal:** la línea sigue y los mensajes llegan después, marcados como atrasados.
6. **Error de arranque y supervisor:** bloqueo y desbloqueo remoto por radio.
7. **Complete una charola:** 4 bolsas que siguen solas hasta SM1.

El avance se guarda en el navegador. **Reiniciar misiones** las borra.

### 5.5 Viaje del mensaje

Cada vez que escanea algo, un cuadrito recorre el camino real del mensaje:

**Terminal → Aire LoRa → Gateway → Puente → Broker MQTT → MES**, y de regreso un círculo verde (el ACK, la confirmación).

Cada parada muestra el dato real (tamaño de la trama, tiempo en el aire, señal, tópico MQTT) y abajo se explica en palabras simples qué está pasando. Si la trama choca con otra o se pierde, verá el cuadrito rojo y el reintento.

Con **Cámara lenta** apagada, el recorrido va a la velocidad de la animación más rápida. Debajo están **los bytes** que viajaron por radio, separados por color: cabecera, datos fijos, datos variables y firma.

### 5.6 Escaneos de esta sesión

Lista de todo lo que escaneó, con el estado de cada mensaje que se actualiza solo: *en memoria*, *viajando por radio*, *reintentando*, *publicado en MQTT*, *guardado en el MES*, *confirmado* o *entregado con retraso*.

## 6. Pestaña Radio y MQTT

Para quien quiera ver "las tripas":

- **Traducción de una trama:** una trama real en bytes y el JSON en que se convirtió. Marque *Detener* para estudiarla con calma.
- **Aire LoRa:** cada transmisión con su resultado (recibida, colisión, perdida, sin señal), tamaño y tiempo en el aire.
- **Broker MQTT:** todos los mensajes publicados. Filtre por `evento`, `cmd`, `alerta` o `erp`. Con un cliente MQTT (por ejemplo MQTT Explorer) puede conectarse a `localhost:1883` y ver lo mismo.

## 7. Pestaña Trazabilidad

Escriba cualquier código y presione **Rastrear**:

| Busca | Ejemplo | Muestra |
|---|---|---|
| OT | `OT-2611-001` | Resina usada, bolsas, cajas y tarimas |
| Bolsa | `OT-2611-001-B004` | Peso, operador, caja en que quedó y tarima |
| Caja | `CJ-000003` | Las bolsas que contiene y de qué OT y lote vienen |
| Tarima | `TR-0001` | Cajas, orden de embarque y despacho |
| Lote de resina | `LMP-2611-001` | Todas las OT que lo usaron (para un retiro de producto) |

Abajo aparecen todos los eventos de ese código en orden, con su CP, resultado y estación. Las OT recientes se pueden abrir con un clic.

## 8. Pestaña Configuración

Aquí se cambia lo que el cliente quiera ver distinto, sin tocar código. Se guarda en el servidor y se aplica al momento en **todos** los paneles abiertos.

- **Colores de estado:** el verde, ámbar, rojo y gris de las luces del resumen, las tarjetas, la barra de paros y las alertas. Escriba el color en RGB (`31, 138, 76`) o en hexadecimal (`#1f8a4c`), o elíjalo con el selector. También se puede cambiar el nombre de cada estado (por ejemplo *En falla* → *Paro*); los conteos de cada línea usan ese nombre. El número dentro de cada luz cambia solo a blanco o negro para que se lea.
- **Planta:** el nombre y el subtítulo de la barra superior, y su color.
- **Colores de los checkpoints:** el color de cada área en la línea CP 01–16.
- **Voceo:** encenderlo o apagarlo, cuántas veces se repite cada aviso, los tiempos (no repetir, no vocear atrasados, volver a vocear) y la tabla de **qué alerta llama a quién**.

Los colores se ven en vivo mientras se editan, antes de guardar. **Deshacer cambios** vuelve a lo guardado. Si un color está mal escrito, el campo se marca en rojo y no deja guardar.

## 9. Mantenimiento ASETI (solo soporte)

Página para el equipo de ASETI: **http://localhost:8080/aseti.html** (en el servidor, la misma dirección del panel más `/aseti.html`). No aparece en el panel.

Pide la **clave de mantenimiento**. Está en la variable `ASETI_TOKEN` del servidor o, si no se puso, en el archivo `simulador/datos/aseti-token.txt`, que se crea la primera vez. Después de 5 claves equivocadas en un minuto, esa computadora espera un minuto.

- **Diagnóstico:** cada chequeo en *Bien* o *Revisar* (broker MQTT, MES, puente, voceo, terminales, memoria, errores), terminales con problemas, errores recientes, la base de datos y el equipo. **Descargar diagnóstico** guarda todo en un archivo para mandarlo a soporte.
- **Acciones de mantenimiento:** revisar la integridad de la base, respaldarla, compactar el registro WAL, desbloquear todas las terminales, restablecer la señal LoRa, quitar fallas programadas, prueba de voceo y restablecer la configuración. Las que cambian algo piden un segundo clic. Cada una queda en el **Registro de acciones** con fecha e IP.

Por seguridad, la página solo corre esas acciones; no ejecuta comandos libres del servidor.

## 10. Preguntas frecuentes

**No veo nada en la página.** El servidor no está encendido. Ejecute `npm start` y recargue.

**No encuentro cómo tomar el control.** En la pestaña *Terminal*, en el modo **Recorrido guiado**, el botón **Siguiente** lo hace por usted; en el modo libre está arriba a la izquierda. Si no aparece, recargue con `Ctrl + F5`.

**El botón Siguiente está apagado y dice "Esperando…".** La OT se está preparando (resina, mezanina, sobre). Se activa solo en unos segundos.

**"Pedir OT nueva" está apagado.** La máquina ya tiene una OT en curso o en preparación. Lea el texto de ayuda debajo de los botones.

**La terminal está en rojo y no acepta escaneos.** Está bloqueada por un error de arranque. Presione *Llamar al supervisor* (en el modo guiado, el botón Siguiente hace lo mismo).

**El escaneo dice correcto pero el mensaje sigue "en memoria".** La terminal ya validó; solo falta que la radio lo entregue. Si la señal está cortada, restablézcala.

**¿Por qué algunos mensajes dicen "entregado con retraso"?** Se generaron sin señal y llegaron después. El sistema guarda la hora real del escaneo, no la de llegada.

**Activé el sonido y no se oye nada.** Revise el volumen de la computadora. Pruebe **Vocear ahora**: si dice *falta el MP3*, se usa la voz del navegador, que en algunas computadoras viene apagada.

**Cambié los colores y otra persona no los ve.** Hay que presionar **Guardar**; hasta entonces solo se ven en su pantalla.

**¿Se pierden datos si se apaga el simulador?** La base de datos se guarda en `simulador/datos/`, pero cada inicio arranca una planta nueva.

## 11. Glosario

| Término | Significado |
|---|---|
| OT | Orden de trabajo |
| TEP | Trabajo en proceso |
| CP | Checkpoint: punto donde se escanea y se valida |
| Gate | Regla que decide si un paso es correcto (PASS) o no (FAIL) |
| LoRa | Radio de largo alcance y bajo consumo; no necesita cables ni WiFi |
| Gateway | Radio conectada al servidor que recibe a todas las terminales |
| MQTT | Sistema de mensajes que reparte cada evento a quien lo necesite |
| MES | Sistema de ejecución de manufactura: guarda todo y aplica las reglas |
| ACK | Confirmación de que un mensaje llegó |
| Búfer / memoria | Mensajes guardados en la terminal esperando confirmación |
| Andon | Torreta de luces que indica el estado de la estación |
| Voceo | Aviso por altavoz que llama a una persona a un lugar |
| Conmutador | Central telefónica de la planta; reparte el audio a las bocinas y teléfonos Fanvil |
| SM1 | Estación de empaque donde las bolsas se meten en cajas |
| Genealogía | Cadena completa: resina → OT → bolsa → caja → tarima → embarque |

