# 05 · Documentación técnica

> **Última actualización:** 2026-11-24
> **Aplica a:** simulador v0.1 (`simulador/`) y al diseño del sistema real que lo reemplaza pieza por pieza.
> **Público:** quien programe el firmware, el servidor o la integración con ERP/WMS.

## 1. Propósito

El sistema valida con escaneos cada checkpoint (CP 01–CP 16) de la planta de inyección y guarda la genealogía completa: **lote de resina → OT → bolsa → caja → tarima → embarque**. La comunicación de piso es por LoRa (no se puede cablear y el WiFi tiene interferencia) y se traduce a MQTT en el servidor.

El simulador implementa esa arquitectura completa en software. Las piezas del servidor (puente, broker, MES, base de datos, panel) son las que se usarán en planta; las piezas de campo (terminal, radio, lector, báscula) están simuladas y se reemplazan por hardware.

## 2. Arquitectura

```
 CAMPO                       EDGE (terminal por estación)          SERVIDOR EN PLANTA                         EMPRESA
 Lector QR/barras ──UART──►  ESP32 + LoRa (Heltec LoRa32)          Gateway LoRa ──USB──► Puente LoRa↔MQTT     ERP
 Báscula ─────────RS-232──►  · gate local (responde al instante)          ▲                    │               WMS
 Andon / buzzer ◄──────────  · memoria de eventos (búfer)               LoRa                   ▼
                             · reloj sincronizado por ACK            915 MHz            Broker MQTT
                                         │                              │                    │
                                         └──────────── radio ───────────┘              MES + SQL ──► panel web
```

| Pieza | Archivo del simulador | En planta | Se reutiliza |
|---|---|---|---|
| Protocolo binario v1 | `src/protocolo/trama.js` | Firmware y puente | Sí: es la especificación |
| Gate local por estación | `src/nodo/nodo.js`, `src/nodo/estaciones.js` | Firmware ESP32 (C++) | Se traduce la lógica |
| Radio LoRa | `src/radio/canal-lora.js` | SX1276/SX1262 | No: se reemplaza por el puerto serie del gateway |
| Puente LoRa ↔ MQTT | `src/puente/puente-lora-mqtt.js` | Servidor | Sí |
| Broker MQTT | Aedes embebido (`src/index.js`) | Mosquitto | Mismos tópicos |
| MES y gates centrales | `src/mes/mes.js` | Servidor | Sí |
| Base de datos | `sql/esquema.sql` (SQLite) | MySQL o PostgreSQL | Esquema portable |
| Panel web | `src/web/servidor.js`, `public/` | Servidor | Sí |
| Personas en planta | `src/sim/simulacion.js` | Operadores reales | No |

### Principio de diseño: dos niveles de gate

1. **Gate local (en la terminal).** Responde PASS/FAIL al instante aunque no haya señal. La terminal tiene en memoria lo que necesita (OT activa, operadores habilitados, peso nominal y tolerancia, siguiente correlativo), que el MES le carga por LoRa en CP 05.
2. **Gate central (en el MES).** Para reglas que dependen de otra estación; por ejemplo, en CP 11 la mesa de SM1 no puede saber si la charola pasó por CP 10 en la inyectora. Como los eventos de nodos distintos pueden llegar desordenados (uno pudo estar sin señal), el MES deja la regla **pendiente** y la concilia cuando llega el evento atrasado. Si no llega en 10 minutos, genera una alerta roja `GATE_PREVIO_NO_PASS`.

## 3. Protocolo LoRa v1

Todas las tramas siguen este formato. Enteros en *big endian*.

```
┌──────────┬──────────┬──────────┬─────────────────────┬──────────┐
│ byte 0   │ bytes 1-2│ bytes 3-4│ cuerpo (según tipo) │ 4 bytes  │
│ ver|tipo │ id nodo  │ seq      │                     │ firma    │
└──────────┴──────────┴──────────┴─────────────────────┴──────────┘
```

- **byte 0:** versión en los 4 bits altos (hoy `1`), tipo en los 4 bits bajos.
- **id nodo:** `uint16`. Inyectoras = línea × 100 + número (L1-INY-01 = 101, L2-INY-20 = 220, L3-INY-09 = 309). Estaciones compartidas: MP 901, mezanina 902, SM1 911–914, PT 921–922, visión 931.
- **seq:** `uint16`, contador propio de cada nodo; identifica el mensaje para el ACK y para eliminar duplicados.
- **firma:** primeros 4 bytes de `HMAC-SHA256(clave_del_nodo, cabecera + cuerpo)`. La clave del nodo es `HMAC-SHA256(clave_de_red, "nodo:<id>")`. Una trama con firma inválida se descarta y se publica en `.../gateway/rechazo`.

### 3.1 Tipos de mensaje

| Tipo | Valor | Sentido | Cuerpo |
|---|---|---|---|
| EVENTO | 1 | nodo → gateway | `cp u8`, `resultado u8`, `ts u32` (epoch s), campos TLV |
| ESTADO | 2 | nodo → gateway | `ts u32`, `búfer u16`, `bloqueado u8`, campos TLV |
| ACK | 3 | gateway → nodo | `seq confirmado u16`, `ts u32` (hora del servidor, para sincronizar) |
| CMD | 4 | gateway → nodo | `código u8`, campos TLV |
| CMD_ACK | 5 | nodo → gateway | `seq del comando u16`, `resultado u8` |

### 3.2 Campos variables (TLV)

Cada campo es `[etiqueta u8][largo u8][valor]`. Un receptor ignora etiquetas que no conoce (compatibilidad hacia adelante).

| Etiqueta | Campo | Tipo | Etiqueta | Campo | Tipo |
|---|---|---|---|---|---|
| 1 | ot | texto | 15 | ubicacion | texto |
| 2 | operador | texto | 16 | puerta | texto |
| 3 | maquina | texto | 17 | cantidad | u16 |
| 4 | lote | texto | 18 | charola | u8 |
| 5 | bolsa | u16 | 19 | defecto | u8 |
| 6 | total | u16 | 20 | pesoNominal | u16 |
| 7 | peso (g) | u16 | 21 | tolerancia | u16 |
| 8 | caja | texto | 22 | operadores | lista separada por comas |
| 9 | posicion | u8 | 23 | skuProducto | texto |
| 10 | skuResina | texto | 24 | orden | texto |
| 11 | embudo | texto | 25 | numeroParte | texto |
| 12 | tarima | texto | 26 | proveedor | texto |
| 13 | cara | u8 | 27 | cierre | u8 |
| 14 | camara | u8 | | | |

### 3.3 Resultados (byte `resultado`)

| Código | Nombre | Código | Nombre |
|---|---|---|---|
| 0 | PASS | 10 | DEFECTO_CRITICO |
| 1 | CERTIFICADO_INVALIDO | 11 | BOLSA_OTRA_OT |
| 2 | GATE_PREVIO_NO_PASS | 12 | DUPLICADO |
| 3 | RESINA_INCORRECTA | 13 | CAJA_LLENA |
| 4 | OT_NO_ASIGNADA | 14 | CAJA_INCOMPLETA |
| 5 | OPERADOR_NO_HABILITADO | 15 | CAJA_SIN_ENCINTAR |
| 6 | QR_MAQUINA_INCORRECTO | 16 | SKU_NO_COINCIDE |
| 7 | NODO_BLOQUEADO | 17 | TARIMA_INCOMPLETA |
| 8 | PESO_FUERA_TOLERANCIA | 18 | CAMARA_NO_CONFIRMA |
| 9 | SECUENCIA_ROTA | | |

### 3.4 Comandos (byte `código` de CMD)

| Código | Comando | Destino | Datos |
|---|---|---|---|
| 1 | CARGAR_OT | inyectora | ot, skuProducto, total, pesoNominal, tolerancia, operadores |
| 2 | DESBLOQUEAR | inyectora | — |
| 3 | FIN_OT | inyectora | ot |
| 4 | CARGAR_FORMULA | mezanina | ot, skuResina |

### 3.5 Ejemplo: bolsa 1 de 12 (CP 07), 47 bytes

```
11 00 70 00 0a 07 00 6b 02 26 85 01 0b 4f 54 2d 32 36 31 31 2d 30 31 38 05 02 00 01 06 02 00 0c 07 02 09 60 02 05 45 31 30 33 34 xx xx xx xx
│  │     │     │  │  │           │                                   │           │           │           │                       └ firma
│  │     │     │  │  │           └ ot = "OT-2611-018"                └ bolsa = 1 └ total = 12└ peso = 2400 g          └ operador = "E1034"
│  │     │     │  │  └ ts
│  │     │     │  └ resultado 0 = PASS
│  │     │     └ cp = 7
│  │     └ seq = 10
│  └ nodo = 112 (L1-INY-12)
└ versión 1, tipo 1 (EVENTO)
```

Tiempo en aire con SF7 / 125 kHz / CR 4/5: **~92 ms** para 47 bytes y **~46 ms** para un ACK de 15 bytes (fórmula de Semtech AN1200.13, implementada en `tiempoEnAire()`).

## 4. Reglas de entrega

| Parámetro | Valor | Dónde |
|---|---|---|
| Espera del ACK | 2.5 s | `config.js → nodo.esperaAckMs` |
| Intentos antes de "sin enlace" | 4 (espera aleatoria 0.3–1.5 s × intento) | `nodo.maxIntentos` |
| Reintento sin enlace | cada ~20 s | `nodo.reintentoLargoMs` |
| Capacidad de la memoria (búfer) | 500 eventos; si se llena, se descarta el más viejo y se cuenta | `nodo.capacidadBufer` |
| Latido de estado | cada ~120 s, sin ACK | `nodo.latidoMs` |
| Reintentos de comando (gateway) | 5 intentos cada 3–4.5 s; luego `SIN_RESPUESTA` | `puente-lora-mqtt.js` |

1. El nodo transmite **un evento a la vez**, en orden (FIFO). Así los eventos de un mismo nodo nunca llegan desordenados.
2. El puente publica en MQTT con QoS 1 y **solo después** envía el ACK. Si el ACK se pierde, el nodo reenvía y el MES descarta la copia por `UNIQUE(nodo, seq)`.
3. Cada ACK trae la hora del servidor; el nodo ajusta su reloj con ella.
4. El puente marca `diferido: true` cuando la hora del nodo y la del gateway difieren más de 15 s (el evento salió de la memoria después de una desconexión).
5. Los comandos son idempotentes: si el `CMD_ACK` se pierde y el gateway reintenta, el nodo no ejecuta el comando dos veces (recuerda los últimos 50 `seq` de comando).

## 5. MQTT

Prefijo configurable; por defecto `aseti/p1`.

| Tópico | Publica | QoS | Contenido |
|---|---|---|---|
| `aseti/p1/nodo/{nodo}/evento` | puente | 1 | Evento de checkpoint |
| `aseti/p1/nodo/{nodo}/estado` | puente | 0, retenido | Latido: búfer, bloqueo, RSSI, OT cargada |
| `aseti/p1/nodo/{nodo}/cmd` | MES | 1 | Comando para la terminal |
| `aseti/p1/nodo/{nodo}/cmd_ack` | puente | 1 | Respuesta de la terminal o `SIN_RESPUESTA` |
| `aseti/p1/mes/evento` | MES | 0 | Acciones de oficina (CP 03, CP 05) |
| `aseti/p1/alerta` | MES | 0 | Alertas de gate local o central |
| `aseti/p1/voceo` | MES | 1 | Aviso que el conmutador debe reproducir (ver 5.1) |
| `aseti/p1/erp/despacho` | MES | 1 | Cierre de trazabilidad en CP 16 |
| `aseti/p1/gateway/traza` | puente | 0 | Trama en hex + JSON traducido (diagnóstico) |
| `aseti/p1/gateway/rechazo` | puente | 0 | Tramas con firma inválida o nodo desconocido |

**Evento** (`.../nodo/L1-INY-12/evento`):

```json
{
  "nodo": "L1-INY-12", "nodo_id": 112, "seq": 10, "cp": 7,
  "resultado": "PASS", "codigo": "PASS",
  "ts_nodo": "2026-11-21T23:10:46.000Z", "ts_gateway": "2026-11-21T23:10:46.000Z",
  "diferido": false, "rssi": -79, "snr": 8.2,
  "datos": { "ot": "OT-2611-018", "bolsa": 1, "total": 12, "peso": 2400, "operador": "E1034" }
}
```

**Comando** (`.../nodo/L1-INY-12/cmd`):

```json
{ "id": "6f1c…", "cmd": "CARGAR_OT", "datos": { "ot": "OT-2611-018", "skuProducto": "CONT-500-PE", "total": 12, "pesoNominal": 2400, "tolerancia": 40, "operadores": ["E1034", "E1035", "E1036"] } }
```

**Despacho al ERP** (`.../erp/despacho`):

```json
{ "tarima": "TR-0003", "orden_embarque": "OE-2611-003", "numero_parte": "TAP-28-PP", "puerta": "P-4",
  "cajas": ["CJ-000007", "CJ-000009", "CJ-000012"], "ots": ["OT-2611-004"], "estatus_trazabilidad": "COMPLETO", "ts_salida": "…" }
```

### 5.1 Voceo por conmutador

El módulo `src/mes/voceo.js` escucha `alerta`, `nodo/+/evento` y `nodo/+/cmd_ack`, y publica en `voceo` el aviso que hay que tocar en los Fanvil. Los textos y MP3 salen de la carpeta `voceo/` (`VOCEO_DIR` para cambiarla).

```json
{ "id": "9518d3f9-…", "ts": "2026-11-24T16:34:52Z", "rol": "supervisor", "destino": "L2-INY-07",
  "archivo": "supervisor__L2-INY-07.mp3", "texto": "Supervisor de producción, favor de acudir a línea dos, inyectora siete.",
  "repetir": 2, "escalamiento": 0,
  "alerta": { "codigo": "OPERADOR_NO_HABILITADO", "cp": 6, "nodo": "L2-INY-07", "ot": "OT-2611-018", "nivel": "rojo" } }
```

`escalamiento` es 0 en el primer aviso y 1, 2 cuando se repite porque la máquina sigue bloqueada. `alerta` es `null` en las pruebas manuales desde el panel.

| Código | A quién | Lugar |
|---|---|---|
| `OPERADOR_NO_HABILITADO`, `QR_MAQUINA_INCORRECTO`, `OT_NO_ASIGNADA`, `NODO_BLOQUEADO` | Supervisor (con escalamiento si es CP 06) | La inyectora |
| `DEFECTO_CRITICO` | Calidad | La inyectora |
| `CERTIFICADO_INVALIDO` | Calidad | Materia prima |
| `RESINA_INCORRECTA` | Supervisor | Mezanina |
| `GATE_PREVIO_NO_PASS` | Supervisor | La estación que lo detectó |
| `BOLSA_OTRA_OT`, `DUPLICADO` | Calidad | Mesa de SM1 |
| `SKU_NO_COINCIDE`, `TARIMA_INCOMPLETA` | Supervisor | Puesto PT (la cámara VIS-01 se vocea como embarque) |
| `PESO_FUERA_TOLERANCIA`, `SECUENCIA_ROTA`, `CAJA_SIN_ENCINTAR`, `CAJA_INCOMPLETA`, `CAJA_LLENA`, `CAMARA_NO_CONFIRMA` | No se vocea, solo panel | — |

Reglas: no se vocea un evento atrasado (búfer de la terminal) de más de 2 min; el mismo llamado no se repite antes de 5 min; un bloqueo de CP 06 se vuelve a vocear a los 5 y 10 min si no llega el `cmd_ack` de `DESBLOQUEAR` ni un CP 06 en PASS. Todos los tiempos son simulados (se aceleran con la velocidad del panel). Los tiempos, las repeticiones y qué código llama a quién se cambian en la pestaña Configuración (D19); los de esta tabla son los valores de fábrica.

## 6. Gates por checkpoint

| CP | Estación | Gate local (terminal) | Gate central (MES) |
|---|---|---|---|
| 01 | MP-01 | Certificado válido | — |
| 02 | MP-01 | Lote recibido y aprobado | — |
| 03 | MES | — | Hay resina aprobada del SKU en la mezanina |
| 04 | MEZ-01 | OT cargada; SKU de resina = formulación de la OT | — |
| 05 | MES | — | Existe CP 04 en PASS (espera si viene atrasado) |
| 06 | INY-xx | OT cargada, terminal no bloqueada, operador habilitado, OT correcta, QR de esta máquina | — |
| 07 | INY-xx | Arranque hecho, correlativo siguiente, peso en tolerancia | — |
| 08 | INY-xx | Bolsa registrada; sin defecto crítico | — |
| 09 | INY-xx | Charola inspeccionada | — |
| 10 | INY-xx | Charola liberada | — |
| 11 | SM1-0x | Bolsa de la OT de la caja, sin duplicados, caja no llena | La bolsa pasó CP 10; no está en otra caja |
| 12 | SM1-0x | Caja completa y encintada | — |
| 13 | PT-01 | Caja no ingresada antes | La caja está cerrada (CP 12) |
| 14 | PT-01 | Número de parte = orden de embarque; caja ingresada; cantidad completa al cerrar | La caja está en PT (CP 13) |
| 15 | VIS-01 | La cámara confirma cada cara | La tarima está armada (CP 14) |
| 16 | VIS-01 | 4/4 caras verificadas | Tarima verificada; publica el despacho al ERP |

## 7. Base de datos

Esquema en `simulador/sql/esquema.sql`.

```
lotes_mp ─< cargas_resina >─ ordenes_trabajo ─< bolsas
                                    │              │ (id_bolsa)
                                    └─< cajas ─< caja_bolsas
                                          │
                                     tarimas ─< cajas
eventos  (todo lo que llega, UNIQUE(nodo, seq))
alertas  (gate local o central)
inspecciones_tep
```

- `caja_bolsas` **no** tiene llave foránea hacia `bolsas` a propósito: el evento de SM1 puede llegar antes que el de la inyectora. La conciliación del MES completa el estado después.
- `eventos.ref` guarda el identificador principal del evento (bolsa, caja, tarima o lote) para consultas rápidas.

Consulta de genealogía hacia atrás desde una caja:

```sql
SELECT c.id_caja, cb.posicion, b.id_bolsa, b.peso_g, o.ot, o.id_maquina, cr.id_lote, l.proveedor
FROM cajas c
JOIN caja_bolsas cb ON cb.id_caja = c.id_caja
LEFT JOIN bolsas b ON b.id_bolsa = cb.id_bolsa
JOIN ordenes_trabajo o ON o.ot = c.ot
LEFT JOIN cargas_resina cr ON cr.ot = o.ot AND cr.resultado = 'PASS'
LEFT JOIN lotes_mp l ON l.id_lote = cr.id_lote
WHERE c.id_caja = 'CJ-000003'
ORDER BY cb.posicion;
```

## 8. API HTTP del panel

| Método y ruta | Uso |
|---|---|
| `GET /api/stream` | Flujo SSE: `inicio` (incluye catálogo de avisos y ajustes), `estado` (cada 0.8 s), `aire`, `traza`, `mqtt`, `mes`, `ajustes` (cuando alguien guarda la configuración) |
| `GET /api/genealogia?id=` | Genealogía y eventos de una OT, bolsa, caja, tarima o lote |
| `POST /api/control` | `velocidad`, `perdida`, `intervalo`, `falla`, `sinSenal`, `conSenal`, `probarVoceo` (`clave` del aviso) |
| `GET /api/manual/etiquetas?maquina=` | Estado de la terminal manual y etiquetas disponibles |
| `POST /api/manual` | `tomar`, `soltar`, `pedirOT`, `escanear`, `pesar`, `desbloquear` |
| `GET /voceo/{archivo}.mp3` | Audio del voceo desde `voceo/salida/` (solo nombres `[A-Za-z0-9_-]+.mp3`) |
| `GET /api/ajustes` · `PUT /api/ajustes` | Lee o guarda la configuración (`datos/ajustes.json`). El servidor parte de los valores de fábrica y descarta lo inválido: colores que no son `#rrggbb`, números fuera de rango, roles sin avisos |
| `GET /api/aseti/diagnostico` | Diagnóstico completo (pide clave) |
| `GET /api/aseti/diagnostico.json` | El mismo diagnóstico como archivo descargable |
| `GET /api/aseti/acciones` | Acciones disponibles y las últimas 30 del registro de auditoría |
| `POST /api/aseti/accion` | `{ "id": "bd_respaldo" }`: corre una acción de la lista fija |

Todas las rutas `/api/aseti/*` piden `Authorization: Bearer <clave>`. Responden 401 con clave mala y 429 después de 5 intentos fallidos en un minuto desde la misma IP (bloqueo de 1 minuto). Las acciones se registran en `datos/auditoria.log` (JSON por línea). Para agregar una acción se añade una entrada en `ACCIONES` de `src/aseti/mantenimiento.js`; a propósito no existe una acción que ejecute comandos del sistema (D20).

## 9. Configuración y ejecución

```bash
cd simulador
npm install
npm start                 # panel :8080, MQTT :1883
npm run prueba -- 120     # 120 s sin panel a 40x, con fallas programadas
```

| Variable | Por defecto | Efecto |
|---|---|---|
| `PUERTO_HTTP` | 8080 | Puerto del panel |
| `PUERTO_MQTT` | 1883 | Puerto del broker |
| `PREFIJO_MQTT` | `aseti/p1` | Prefijo de tópicos |
| `VELOCIDAD` | 10 | Factor de tiempo (1 = real) |
| `LINEAS` | `22,20,9` | Inyectoras por línea, separadas por coma |
| `INYECTORAS` | — | Atajo: una sola línea con ese número de inyectoras |
| `OPERADORES_RESINA` | 3 | Cargas de resina en paralelo en la mezanina (CP 04) |
| `MESAS_SM1` | 4 | Mesas de empaque en SM1 (CP 11–12), una terminal por mesa |
| `PUESTOS_PT` | 2 | Puestos de paletizado en PT (CP 14), una terminal por puesto |
| `BOLSAS_OT` | 12 | Bolsas por OT (múltiplo de 4) |
| `INTERVALO_BOLSA` | 90000 | ms simulados entre bolsas por máquina |
| `PERDIDA` | 0.02 | Probabilidad base de perder una trama por ruido |
| `TASA_FALLAS` | 0 | Fallas aleatorias además de las programadas |
| `CLAVE_RED` | valor de demostración | Clave para firmar tramas |
| `ASETI_TOKEN` | se genera en `datos/aseti-token.txt` | Clave de la página de mantenimiento |
| `VOCEO_DIR` | `../voceo` | Carpeta con el catálogo y los MP3 del voceo |

Archivos que el servidor guarda en `datos/` (no van a git): la base `trazabilidad.db` (se reinicia en cada arranque), `ajustes.json`, `aseti-token.txt`, `auditoria.log` y `respaldos/`. En Docker, `datos/` es el volumen `trazabilidad_datos`.

Requiere Node.js 22.13 o superior (`node:sqlite`).

## 10. Resultados de prueba

Prueba sin panel de 120 s a 40× (≈ 80 min de planta), 28 nodos, fallas programadas:

| Medida | Valor |
|---|---|
| OT completas / tarimas despachadas | 16 / 16 |
| Ocupación del canal | ~8 % |
| Tramas con colisión | ~12 % (absorbidas por reintentos) |
| Eventos perdidos | 0 |
| Fallas programadas detectadas | 8 de 8, incluida una charola sin CP 10 (gate central) |

Hallazgo de capacidad: con una sola mesa en SM1 la estación se satura (supuesto: 1 bolsa cada 90 s por máquina). La simulación usa dos mesas. Hay que confirmar el ritmo real con la planta.

**Con 3 líneas (51 inyectoras, 2026-11-21).** Tres corridas del panel a 40×:

| Corrida | OT esperando resina | Tarimas por hora de planta | Canal más ocupado | Tramas con colisión |
|---|---|---|---|---|
| 1 operador de resina, 2 mesas SM1, 1 puesto PT (~1 h de planta) | 33–42 | ~15 | — | ~5 % |
| 3 operadores, 4 mesas, 2 puestos; estaciones en un solo canal (~5 h) | 4–16 | ~45 | 24 % (estaciones) | ~19 % |
| Igual, con las mesas de SM1 en dos canales propios (~3 h) | 2–12 | ~45 | ~10 % | ~8 % |

Los números de operadores, mesas y puestos son supuestos (D17).

## 11. Paso a hardware

1. **Firmware de la terminal (ESP32):** portar `Nodo` (seq, cola FIFO en flash, ACK, reintentos, reloj) y la clase de su estación (`NodoInyectora`, etc.). Codificar y decodificar con el formato de la sección 3. El método `escanear()` de `NodoInyectora` ya separa los códigos por formato como lo haría el firmware.
2. **Lector:** módulo con salida UART (GM65/GM67). Cada lectura termina en `\r`; equivale a `escanear(codigo)`.
3. **Báscula:** lectura estable por RS-232 (convertidor a TTL); equivale a `pesar(gramos)`.
4. **Gateway:** una Heltec LoRa32 que reenvía por USB serie cada trama recibida (con RSSI y SNR) y transmite lo que recibe por serie. En el servidor, reemplazar `CanalLoRa` por un lector de puerto serie que llame a `puente.recibir(buf, meta)` y que implemente `transmitir('gw', buf, nodoId)`.
5. **Broker:** cambiar Aedes por Mosquitto; los tópicos no cambian.
6. **Base de datos:** el esquema es SQL estándar; en MySQL cambiar `INTEGER PRIMARY KEY AUTOINCREMENT` por `INT AUTO_INCREMENT` y `json_extract` por la función equivalente.
7. **Claves:** provisionar una clave distinta por nodo en lugar de derivarla de una clave de red compartida.

## 12. Limitaciones conocidas

- `seq` es de 16 bits: después de 65 535 eventos de un mismo nodo se repite y chocaría con `UNIQUE(nodo, seq)`. En producción agregar un contador de arranques o una ventana de tiempo a la llave.
- El canal simulado no modela el *capture effect* (cuando una trama más fuerte sobrevive a una colisión); el resultado real será algo mejor.
- La firma de 4 bytes detecta alteraciones y tramas ajenas, pero no evita que se reenvíe una trama vieja (*replay*). Mitigación prevista: rechazar `ts` fuera de una ventana y `seq` ya vistos.
- El canal simulado supone un gateway de 8 canales que recibe todos a la vez y transmite sin bloquear la recepción. Un gateway real es *half-duplex*: mientras manda un ACK no escucha. Con 51 terminales conviene medirlo en campo (D16). La prueba de concepto con una Heltec como gateway (opción A) tiene un solo canal.
- La pantalla AV de SM1 y la cámara de CP 15 se simulan como nodos LoRa; en planta usarán un equipo local (decisión D11).
- **Voceo en Docker:** la imagen solo copia `simulador/`, así que en el contenedor no está la carpeta `voceo/`. El voceo funciona, pero los avisos se publican sin `texto`, el panel no ofrece «Vocear ahora» y no hay MP3 (los MP3 tampoco van en git). Para tenerlo completo en el servidor hay que copiar `voceo/` y montarla en el contenedor con `VOCEO_DIR`.
- **La pestaña Configuración no pide clave**, igual que los demás controles del panel: en un servidor público cualquiera con el enlace puede cambiar colores y reglas del voceo.
