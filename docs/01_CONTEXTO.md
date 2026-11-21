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
