# Simulador de trazabilidad (CP 01–16) · LoRa → MQTT → MES

> **Última actualización:** 2026-11-21

Simula la planta completa con la misma arquitectura que tendrá el sistema real, para probar el protocolo, el puente a MQTT, los gates y la genealogía antes de tener el hardware.

## Cómo correrlo

Requiere Node.js 22.13 o superior.

```bash
cd simulador
npm install
npm start            # panel en http://localhost:8080 · MQTT en localhost:1883
npm run prueba -- 120   # corre 120 s sin panel, a 40x, con fallas programadas, y muestra un resumen
npm test             # pruebas automáticas (unos 2 s)
```

## Pruebas automáticas

`npm test` corre las pruebas de `test/` con el corredor de Node (`node --test`), sin dependencias extra. GitHub las corre en cada push a `main` (`.github/workflows/pruebas.yml`); si fallan, el commit aparece con una ✗ roja.

| Archivo | Qué cuida |
|---|---|
| `protocolo.test.js` | Codificar y decodificar cada tipo de trama, firma, versión, tamaño del ejemplo de 47 bytes |
| `estaciones.test.js` | El gate local de cada terminal (CP 01–16) da el código correcto; búfer, ACK, reintentos y comandos repetidos |
| `mes.test.js` | Duplicados por radio, alertas roja y ámbar, conciliación de eventos atrasados y la alerta a los 10 min, genealogía |
| `voceo.test.js` | A quién se llama por cada código, silencio de 5 min, atrasos, escalamiento y cancelación al desbloquear |
| `avisos.test.js` | Catálogo de 412 avisos, números con letra, nombres de archivo seguros |
| `ajustes.test.js` | La configuración descarta colores, números y roles inválidos y se guarda sin dañar el archivo |
| `mantenimiento.test.js` | Clave, bloqueo tras 5 intentos, solo acciones de la lista, auditoría |
| `integracion.test.js` | De punta a punta con broker MQTT real: terminal → LoRa → puente → MES → voceo, y desbloqueo de regreso |

Las pruebas usan un reloj falso para avanzar minutos al instante y una carpeta temporal para la base; no tocan `datos/` ni los puertos 8080/1883.

Variables útiles: `PUERTO_HTTP`, `PUERTO_MQTT`, `VELOCIDAD` (1 = tiempo real; por defecto 10), `LINEAS` (por defecto `22,20,9`), `MESAS_SM1`, `PUESTOS_PT`, `OPERADORES_RESINA`, `BOLSAS_OT`, `INTERVALO_BOLSA` (ms), `PERDIDA` (0–0.9), `TASA_FALLAS`.

El broker MQTT es real: se puede conectar MQTT Explorer o `mosquitto_sub -h localhost -t 'aseti/p1/#' -v` para ver el tráfico.

## Qué es real y qué es simulado

| Pieza | En la simulación | En planta | ¿Se reutiliza? |
|---|---|---|---|
| Protocolo binario (`src/protocolo/trama.js`) | Real | Mismo formato en el firmware del ESP32 | Sí, es la especificación |
| Lógica de gate por estación (`src/nodo/`) | Clases JS | Firmware de cada nodo | Se traduce a C++ |
| Radio LoRa (`src/radio/canal-lora.js`) | Simulada: tiempo en aire real (SF7/125 kHz), colisiones, ruido, cortes de señal | SX1276/SX1262 | No: se reemplaza por el puerto serie del gateway |
| Puente LoRa ↔ MQTT (`src/puente/`) | Real | Corre en el servidor junto al gateway | Sí, sin cambios salvo la entrada de radio |
| Broker MQTT | Aedes (embebido) | Mosquitto | Mismos tópicos |
| MES y base de datos (`src/mes/`, `sql/esquema.sql`) | Real (SQLite) | MySQL/PostgreSQL | Sí; el esquema es portable |
| Personas en planta (`src/sim/simulacion.js`) | Escenarios automáticos | Operadores, inspectores, charoleros | No |

## Qué se puede ver en el panel

- **Planta:** la pantalla de cada terminal (51 inyectoras en 3 líneas con vista de toda la planta o por línea, MP, mezanina, 4 mesas de SM1 con la pantalla AV, 2 puestos de PT y visión con la matriz o/x), los conteos por CP, las alertas y los controles.
- **Radio y MQTT:** una trama desarmada byte por byte junto al JSON que publica el puente, el registro del aire (colisiones, pérdidas, RSSI) y el tráfico del broker.
- **Trazabilidad:** búsqueda por OT, bolsa, caja, tarima o lote de resina, con el árbol de genealogía y el historial de eventos.
- **Voceo (en Planta):** el MES decide qué alertas se anuncian por altavoz y publica en `aseti/p1/voceo`; el navegador hace de conmutador de prueba. Ver `../voceo/README.md`.
- **Configuración:** colores de estado del cliente, nombres, colores de CP y reglas del voceo, guardados en el servidor.
- **Mantenimiento ASETI** (`/aseti.html`, con clave): diagnóstico y acciones de soporte auditadas.

## Fallas que se pueden provocar

Certificado inválido (CP 01), resina incorrecta (CP 04), operador no habilitado o QR de otra máquina (CP 06), peso fuera de tolerancia o salto correlativo (CP 07), defecto crítico (CP 08), charola sin registro de retiro (CP 10), bolsa de otra OT o duplicada (CP 11), caja sin encintar (CP 12), caja de otro número de parte (CP 14), cámara que no confirma (CP 15). También se puede **cortar la señal** de cualquier nodo para ver el búfer, el reenvío y la conciliación.

## Dos tipos de gate

1. **Gate local (en el nodo):** responde al instante aunque no haya señal. Ejemplo: CP 06 compara gafete, OT y QR contra la OT que el MES cargó en la terminal.
2. **Gate central (en el MES):** necesita datos de otra estación. Ejemplo: en CP 11 la mesa de SM1 no sabe si la charola pasó por CP 10 en la inyectora. Como los eventos de nodos distintos pueden llegar desordenados (un nodo pudo estar sin señal), el MES deja la validación **pendiente** y la concilia cuando llega el evento atrasado; si no llega en 10 minutos, genera la alerta.

## Lo que mostró la primera prueba (120 s a 40x ≈ 80 min de planta)

- 28 nodos con un solo canal: ocupación del aire cercana al 8 % y alrededor del 12 % de tramas con colisión. Los reintentos y la eliminación de duplicados en el MES (`UNIQUE(nodo, seq)`) absorbieron las colisiones sin perder ningún evento.
- Con una sola mesa en SM1, la estación se saturaba con 22 inyectoras; con dos mesas el flujo se mantiene. **Dato a validar con la planta.**
- Con 3 líneas (51 inyectoras) hacen falta 3 operadores de resina, 4 mesas de SM1 y 2 puestos de PT, y repartir las estaciones en 3 canales LoRa: ningún canal pasa de ~10 % y las colisiones quedan en ~8 %. **Supuestos a validar con la planta.**
- Todas las fallas programadas se detectaron, incluida la charola que llegó a SM1 sin CP 10 (detectada por el gate central).

## Despliegue en servidor

Con Docker, detrás de Nginx Proxy Manager:

```bash
git clone https://github.com/emmiliotapia/trazabilidad.git
cd trazabilidad/simulador
docker compose up -d --build
```

El contenedor `aseti_trazabilidad` escucha en el puerto 8080 dentro de la red `root_default`. No publica puertos al host, ni siquiera el broker MQTT. En el proxy, apunte el dominio a `aseti_trazabilidad:8080`.

Para actualizar: `git pull && docker compose up -d --build`.

El panel no pide usuario y cualquiera con el enlace puede provocar fallas, tomar una terminal o cambiar la configuración. Es una demostración y no guarda datos reales. La página de mantenimiento (`/aseti.html`) sí pide clave: póngala en `ASETI_TOKEN` en `docker-compose.yml` o léala con `docker exec aseti_trazabilidad cat datos/aseti-token.txt`.

`datos/` queda en el volumen `trazabilidad_datos`, así la configuración, la clave y la auditoría sobreviven a `--build`.
