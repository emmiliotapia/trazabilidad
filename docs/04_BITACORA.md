# 04 · Bitácora

> **Última actualización:** 2026-11-27
> Lo más reciente va arriba.

## 2026-11-27 (cierre de sesión: pendientes de la demo con placas)

**Pendiente**
- **Riesgo en `FIN_OT` del firmware de la terminal:** limpia la OT que tenga sin revisar el campo `ot`. Al reiniciar el simulador, la resincronización mandó «cierra la OT-2611-037» y pudo borrar la OT-2611-001 recién cargada. Arreglo: que solo cierre si el número coincide, y volver a subir el programa a la placa (COM7).
- Elegir el scanner por placa. Recomendado: Steren COM-5965, que lee QR, con adaptador USB-host CH9350. Lo decide el usuario después de probar con el celular.
- Portal para asignar placas a máquinas por MAC. Está propuesto y no se ha construido.

## 2026-11-27 (dos placas LoRa de prueba)

**Hecho**
- Llegaron 2 placas: Heltec WiFi LoRa 32 **V2**, radio **SX1276**, **915 MHz**, OLED 0.96" (etiqueta SKU AR3187). Con eso se cierra el pendiente de versión y banda.
- Traen el demo de fábrica (una transmite paquetes numerados y la otra los recibe). Sobre la mesa: RSSI −63 dBm, SNR 9.25 dB. Las dos radios funcionan.
- Driver CP210x instalado: las placas quedan en COM7 y COM9. PlatformIO instalado con pip.
- **Paso 0 aprobado** (`firmware/hola`): pantalla, LED, botón PRG y chip de radio responden con los pines de la V2. Chip ESP32-D0WDQ6.
- **Paso 2 aprobado** (`firmware/lib/trama` + `firmware/paridad`): el protocolo en C++ arma 5 tramas de ejemplo idénticas byte por byte a `trama.js` (firma incluida) y lee bien un ACK, un comando de cargar OT y rechaza uno alterado. Se corre con `python firmware/paridad/comparar.py COM7`; los ejemplos esperados salen de `simulador/herramientas/vectores-paridad.mjs`.
- `serialport` (Node 26, Windows) solo entrega los datos recibidos cuando se vuelve a escribir al puerto; por eso la prueba habla con la placa desde Python (pyserial). Queda pendiente decidir cómo lee el puerto el puente del gateway.
- **Demo de punta a punta con hardware real:** firmware de gateway (COM9) y de terminal L1-INY-01 (COM7). El simulador hace de MES con `GATEWAY_SERIE=COM9`: el MES cargó la OT por radio, y gafete → OT → QR dio PASS (CP 06), la bolsa 1 PASS y la bolsa 3 FAIL por secuencia rota (CP 07), todo en la base con RSSI −52 dBm y sin diferidos. La inyectora simulada queda como gemelo de la placa (`src/radio/gateway-serie.js`); el puerto lo abre `herramientas/serie.py`.
- Etiquetas QR imprimibles en `/etiquetas.html` (endpoint `/api/qr`, librería `qrcode`).
- El lector disponible es USB (de teclado), no Bluetooth. Para la prueba, la laptop recibe el escaneo y se lo pasa a la terminal ESP32 por USB; el lector UART (GM65) se conecta directo en planta.

**Pendiente**
- Prueba de alcance en planta con el demo de fábrica (RSSI, SNR y paquetes seguidos en la inyectora más lejana de cada línea, mezanina y SM1), antes de cargar nuestro firmware.
- Firmware de la terminal (inyectora, CP 06–07): códigos por USB, gate local, seq, cola, ACK y reintentos.
- Firmware del gateway y canal serie para el puente (decidir Node 22 o pyserial).

## 2026-11-24 (voz Renata)

**Hecho**
- Por petición, la voz del voceo cambia a Renata (ElevenLabs, latinoamericana, `vTh15aXpXCElYDOJnJK0`). Generados 88 avisos con `generar.mjs --primeras 10`: todos los roles en L1-INY-01 a L1-INY-10, montacargas en sus 5 lugares y los 13 generales (5 216 caracteres, cabe en el plan gratuito).
- Los 53 de Ana María se guardaron en `voceo/salida/ana_maria/`.
- Panel: cuando falta el MP3, la voz del navegador ahora elige la mejor voz en español disponible (las «Natural» de Edge o la de Google en Chrome) en vez de la de sistema, que sonaba robótica.

**Pendiente**
- Las líneas 2 y 3, la mezanina, SM1 y PT todavía no tienen audio con Renata (salvo montacargas). Para el demo, programar fallas en L1-INY-01 a L1-INY-10.
- Los 412 completos: ~26 000 caracteres, hace falta el plan Starter.

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

### 2026-11-27 · Protecciones para la demo con placas reales

- **Problema visto:** al subir firmware la terminal perdió su OT (vive en RAM) y el simulador seguía creyendo que iba a la mitad.
- **Resincronización** (`simulador/src/radio/gateway-serie.js`): con cada latido (ESTADO) se compara OT y última bolsa de la placa contra el gemelo; si difieren se le manda CARGAR_OT directo con `bolsa` y `operador` (o FIN_OT si su OT ya no está activa). El firmware acepta esos dos campos y reanuda sin repetir el arranque. Sin OT, el latido va cada 10 s.
- **Hallazgo importante:** tras reiniciar, la placa volvía a numerar sus mensajes desde 1 y el MES los descartaba como repetidos (`UNIQUE(nodo, seq)`): la bolsa quedaba PASS en la placa y no existía en la base. Corregido guardando `seq` en NVS por bloques de 256 (placa nueva: bloque al azar). Aplica también a producción. Sigue pendiente el desborde a los 65 535 eventos (ver 05_DOCUMENTACION_TECNICA).
- Si el USB del gateway se desconecta, `serie.py` termina y el simulador lo reabre cada 3 s. La página del celular se reconecta sola por BLE.
- Prueba en placas reales: arranque, 2 bolsas, reinicio, bolsa 3, reinicio, bolsa 4, desconexión del gateway, bolsa 5 → MES con las 5 bolsas, resincronización en ~4 s.
- **Botón "Reiniciar OT"** en `/etiquetas.html`: cancela la OT en curso (estado `CANCELADA` en la base, FIN_OT a la placa) y pide otra que empieza en la bolsa 1. Solo en fase de producción.
- **Hallazgo:** al reiniciar el simulador el puente vuelve a numerar sus comandos desde 1 y la placa los tomaba por repetidos (contestaba CMD_ACK pero no los ejecutaba). Corregido en el firmware: un comando es repetido solo si coinciden número **y** contenido (huella FNV-1a del cuerpo).

