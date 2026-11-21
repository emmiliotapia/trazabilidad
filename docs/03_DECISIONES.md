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
