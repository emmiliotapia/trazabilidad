# Voceo por conmutador (ElevenLabs → MP3 → Fanvil)

Avisos pregrabados para que suenen en las bocinas o teléfonos Fanvil del conmutador cuando llega una alerta por MQTT.

- `catalogo.json`: roles, destinos y avisos generales. Se edita aquí y se vuelve a generar.
- `avisos.mjs`: arma la lista de avisos; la usan el generador y el MES del simulador.
- `generar.mjs`: crea los MP3 con la API de ElevenLabs y el `salida/manifiesto.json`.
- `salida/`: los MP3 y el manifiesto. No se sube a git.

## Generar

```bash
cp .env.example .env               # poner ELEVENLABS_API_KEY
node generar.mjs --voces           # solo si se quiere cambiar la voz (por defecto Ana María, mexicana)
node generar.mjs --seco            # ver los 412 avisos (~26 mil caracteres) sin gastar créditos
node generar.mjs --solo 3          # probar cómo suena la voz
node generar.mjs                   # generar todo (lo que ya existe se salta)
```

Se necesita Node 18 o más nuevo. No hay dependencias.

Créditos: ~26 000 caracteres en total. El plan gratuito de ElevenLabs da 10 000 al mes, así que hace falta un plan de pago (Starter o más). Si después cambias un texto, borra solo ese MP3 y vuelve a correr el script.

## Qué se genera

| Tipo | Archivo | Ejemplo |
|---|---|---|
| Llamado | `{rol}__{destino}.mp3` | `mantenimiento__L1-INY-21.mp3` → "Mantenimiento, favor de acudir a línea uno, inyectora veintiuno." |
| General | `general__{id}.mp3` | `general__paro_L2.mp3` → "Atención. Paro de línea dos." |

Roles: `supervisor`, `mantenimiento`, `calidad`, `moldes`, `materiales`, `charolero`, `montacargas`, `primeros_auxilios`.
Destinos: las 51 inyectoras con su nombre del sistema (`L1-INY-01` … `L3-INY-09`) y las estaciones `MP-01`, `MEZ-01`, `SM1-01`…`04`, `PT-01`, `PT-02`, `EMB-01`. No todos los roles van a todos los destinos (por ejemplo, el montacargas no va a las inyectoras); el manifiesto tiene la lista exacta.

**El número de máquina se repite en las tres líneas** (hay INY-01 en L1, L2 y L3), así que el aviso siempre dice la línea: "línea uno, inyectora veintiuno".

## Contrato MQTT propuesto

Tópico: `aseti/p1/voceo` (mismo prefijo que el resto del sistema), QoS 1, sin retener.

Lo publica el MES del simulador (`simulador/src/mes/voceo.js`); el detalle de qué alerta llama a quién está en `docs/05_DOCUMENTACION_TECNICA.md`, sección 5.1.

```json
{ "id": "9518d3f9-…", "ts": "2026-11-24T16:34:52Z", "rol": "supervisor", "destino": "L2-INY-07",
  "archivo": "supervisor__L2-INY-07.mp3", "texto": "Supervisor de producción, favor de acudir a línea dos, inyectora siete.",
  "repetir": 2, "escalamiento": 0,
  "alerta": { "codigo": "OPERADOR_NO_HABILITADO", "cp": 6, "nodo": "L2-INY-07", "ot": "OT-2611-018", "nivel": "rojo" } }
```

El servidor del conmutador solo tiene que tocar `archivo` (timbre antes, `repetir` veces). Si el archivo no existe, lo registra como error; `texto` sirve para la bitácora o para un TTS de respaldo. Los avisos generales llegan con `general` en lugar de `rol` y `destino`. Las reglas de cuándo vocear (no repetir, no vocear atrasados, escalar) ya las aplica el MES.

Para probar sin el simulador:

```bash
mosquitto_pub -h <broker> -t aseti/p1/voceo -q 1 -m '{"rol":"supervisor","destino":"L2-INY-07","archivo":"supervisor__L2-INY-07.mp3","repetir":2}'
```

Con el simulador corriendo (`cd simulador && npm start`), el panel tiene «Vocear ahora» para mandar cualquier aviso, y `mosquitto_sub -t 'aseti/p1/voceo'` muestra lo que publica el MES.

## Notas para el conmutador

- El formato es MP3 de 44.1 kHz. Muchos conmutadores (Asterisk, FreePBX, Grandstream UCM) y el voceo SIP/multicast de Fanvil trabajan en G.711 a 8 kHz. Si lo piden en WAV, se convierte así:
  `ffmpeg -i entrada.mp3 -ar 8000 -ac 1 -acodec pcm_s16le salida.wav`
  También se puede pedir directo a ElevenLabs con `FORMATO=ulaw_8000` (μ-law crudo, sin encabezado WAV).
- El timbre o "ding" previo no se genera aquí; conviene que lo ponga el servidor para que sea el mismo en todos los avisos.
