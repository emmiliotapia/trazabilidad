# 04 · Bitácora

> **Última actualización:** 2026-11-21
> Lo más reciente va arriba.

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
