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
