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
