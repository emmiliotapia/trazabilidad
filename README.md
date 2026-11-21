# Trazabilidad · Inyección de plástico (ASETI)

Sistema para validar con escaneo, en cada checkpoint (CP 01–CP 16), que la pieza, el material o la caja sea la correcta, usando dispositivos **LoRa** (no se puede cablear y el WiFi tiene interferencia) con un gateway que traduce a **MQTT** para el servidor.

## Estructura

| Ruta | Contenido |
|---|---|
| `docs/01_CONTEXTO.md` | Problema, convenciones (OT/TEP), los 16 checkpoints vigentes y preguntas abiertas |
| `docs/02_ARQUITECTURA.md` | 4 capas, puente LoRa → MQTT, tópicos, formato de mensaje y validación local |
| `docs/03_DECISIONES.md` | Registro de decisiones con fecha y motivo |
| `docs/04_BITACORA.md` | Avances y pendientes por fecha |
| `docs/05_DOCUMENTACION_TECNICA.md` | Protocolo LoRa, MQTT, gates, base de datos, API y paso a hardware |
| `docs/06_MANUAL_USUARIO.md` | Cómo usar el simulador: pestañas, misiones de la Terminal, fallas y búsqueda |
| `simulador/` | Simulación funcional: nodos LoRa, puente a MQTT, MES con genealogía y panel web (`npm start`) |
| `referencias/` | Diagrama de la empresa, foto de la placa y prototipo visual del panel |
| `PROYECTO_TRAZABILIDAD.md` | **Todo junto en un archivo, para NotebookLM** (generado) |

## Cómo mantener NotebookLM al día

1. Se editan los documentos de `docs/` (nunca `PROYECTO_TRAZABILIDAD.md` a mano).
2. Se regenera el consolidado: `bash scripts/consolidar.sh`
3. Se sube a git (`git add . && git commit -m "..." && git push`).
4. En NotebookLM: se **elimina la fuente anterior** `PROYECTO_TRAZABILIDAD.md` y se sube la nueva.
5. Fuentes fijas en NotebookLM (solo se suben una vez): `referencias/diagrama_flujo_CP01-CP16.jpeg`.

Reglas: cada documento lleva su fecha de actualización arriba, y lo descartado se marca como **DESCARTADO** en lugar de borrarse.
