# Trazabilidad · Inyección de plástico (ASETI)

Sistema para validar con escaneo, en cada checkpoint (CP 01–CP 16), que la pieza, el material o la caja sea la correcta, usando dispositivos **LoRa** porque en la planta no se puede cablear y el WiFi tiene interferencia.

## Estructura

| Ruta | Contenido |
|---|---|
| `docs/01_CONTEXTO.md` | Problema, planta, los 16 checkpoints reales y preguntas abiertas |
| `docs/02_ARQUITECTURA.md` | Nodos LoRa, gateway, servidor y principio de validación local |
| `docs/03_DECISIONES.md` | Registro de decisiones con fecha y motivo |
| `docs/04_BITACORA.md` | Avances y pendientes por fecha |
| `referencias/` | Diagrama de la empresa, foto de la placa y prototipo visual del panel |
| `PROYECTO_TRAZABILIDAD.md` | **Todo junto en un archivo, para NotebookLM** (generado) |

## Cómo mantener NotebookLM al día

1. Se editan los documentos de `docs/` (nunca `PROYECTO_TRAZABILIDAD.md` a mano).
2. Se regenera el consolidado: `bash scripts/consolidar.sh`
3. Se sube a git (`git add . && git commit -m "..." && git push`).
4. En NotebookLM: se **elimina la fuente anterior** `PROYECTO_TRAZABILIDAD.md` y se sube la nueva.
5. Fuentes fijas en NotebookLM (solo se suben una vez): `referencias/diagrama_flujo_CP01-CP16.jpeg`.

Reglas: cada documento lleva su fecha de actualización arriba, y lo descartado se marca como **DESCARTADO** en lugar de borrarse.
