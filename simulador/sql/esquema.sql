-- Esquema de trazabilidad (SQLite en la simulación; portable a MySQL/PostgreSQL)
-- Genealogía: lotes_mp → cargas_resina → ordenes_trabajo → bolsas → caja_bolsas → cajas → tarimas → (embarque)
PRAGMA foreign_keys = ON;

CREATE TABLE lotes_mp (
  id_lote        TEXT PRIMARY KEY,           -- CP 01
  sku_resina     TEXT NOT NULL,
  proveedor      TEXT,
  cantidad_kg    REAL,
  estado         TEXT NOT NULL,              -- APROBADO | CUARENTENA
  ubicacion      TEXT,                       -- ALMACEN_MP | MEZ-... (CP 02)
  id_almacenista TEXT,
  ts_recepcion   TEXT,
  ts_traslado    TEXT
);

CREATE TABLE ordenes_trabajo (
  ot              TEXT PRIMARY KEY,          -- CP 03
  id_maquina      TEXT NOT NULL,
  id_molde        TEXT,
  sku_producto    TEXT NOT NULL,
  sku_resina      TEXT NOT NULL,
  total_bolsas    INTEGER NOT NULL,
  peso_nominal_g  INTEGER,
  tolerancia_g    INTEGER,
  estado          TEXT NOT NULL,             -- PROGRAMADA | LIBERADA | EN_PRODUCCION | MOLDEO_TERMINADO | COMPLETO
  id_planificador TEXT,
  id_supervisor   TEXT,                      -- CP 05
  id_operador     TEXT,                      -- CP 06
  ts_creacion     TEXT,
  ts_liberacion   TEXT,
  ts_arranque     TEXT,
  ts_cierre       TEXT
);

CREATE TABLE cargas_resina (                -- CP 04
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ot          TEXT NOT NULL REFERENCES ordenes_trabajo(ot),
  id_lote     TEXT REFERENCES lotes_mp(id_lote),
  sku_resina  TEXT,
  id_embudo   TEXT,
  id_operador TEXT,
  resultado   TEXT NOT NULL,
  ts          TEXT
);

CREATE TABLE bolsas (                       -- CP 07–10
  id_bolsa    TEXT PRIMARY KEY,              -- OT-2611-001-B007
  ot          TEXT NOT NULL REFERENCES ordenes_trabajo(ot),
  correlativo INTEGER NOT NULL,
  peso_g      INTEGER,
  charola     INTEGER,
  id_operador TEXT,
  estado      TEXT NOT NULL,                 -- MOLDEADA | INSPECCIONADA | CUARENTENA_TEP | LIBERADA | EN_TRASLADO | EN_CAJA
  ts_moldeo   TEXT,
  UNIQUE (ot, correlativo)
);

CREATE TABLE inspecciones_tep (             -- CP 08
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ot           TEXT NOT NULL,
  charola      INTEGER,
  id_bolsa     TEXT,
  resultado    TEXT NOT NULL,
  id_inspector TEXT,
  ts           TEXT
);

CREATE TABLE tarimas (                      -- CP 14–16
  id_tarima       TEXT PRIMARY KEY,
  orden_embarque  TEXT,
  numero_parte    TEXT,
  cajas_esperadas INTEGER,
  caras_ok        INTEGER DEFAULT 0,
  estado          TEXT NOT NULL,             -- ARMANDO | ARMADA | VERIFICADA | DESPACHADA
  puerta          TEXT,
  ts_despacho     TEXT
);

CREATE TABLE cajas (                        -- CP 11–13
  id_caja        TEXT PRIMARY KEY,
  ot             TEXT REFERENCES ordenes_trabajo(ot),
  capacidad      INTEGER,
  total_bolsas   INTEGER DEFAULT 0,
  estado         TEXT NOT NULL,              -- EN_EMPAQUE | CERRADA | EN_PT | EN_TARIMA | DESPACHADA
  id_charolero   TEXT,
  id_inspector_2 TEXT,
  ubicacion      TEXT,
  id_tarima      TEXT REFERENCES tarimas(id_tarima),
  ts_cierre      TEXT,
  ts_ingreso_pt  TEXT
);

-- Sin FK a bolsas a propósito: el evento de SM1 puede llegar antes que el CP 10 de la inyectora
-- (nodos distintos, uno pudo estar sin señal). La validación queda pendiente y se concilia después.
CREATE TABLE caja_bolsas (
  id_caja  TEXT NOT NULL REFERENCES cajas(id_caja),
  id_bolsa TEXT NOT NULL UNIQUE,
  posicion INTEGER,
  ts       TEXT,
  PRIMARY KEY (id_caja, id_bolsa)
);

CREATE TABLE eventos (                      -- todo lo que llega por MQTT, tal cual
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nodo        TEXT NOT NULL,
  seq         INTEGER,
  cp          INTEGER NOT NULL,
  resultado   TEXT NOT NULL,
  codigo      TEXT,
  ot          TEXT,
  ref         TEXT,                          -- bolsa, caja o tarima principal del evento
  datos       TEXT,
  ts_nodo     TEXT,
  ts_gateway  TEXT,
  ts_mes      TEXT,
  diferido    INTEGER DEFAULT 0,
  rssi        INTEGER,
  UNIQUE (nodo, seq)                         -- elimina duplicados por reintentos de radio
);

CREATE TABLE alertas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT,
  nivel    TEXT,                             -- rojo | ambar
  origen   TEXT,                             -- nodo (gate local) | mes (gate central)
  cp       INTEGER,
  nodo     TEXT,
  ot       TEXT,
  codigo   TEXT,
  mensaje  TEXT
);

CREATE INDEX ix_eventos_ot ON eventos(ot);
CREATE INDEX ix_eventos_ref ON eventos(ref);
CREATE INDEX ix_bolsas_ot ON bolsas(ot, charola);
CREATE INDEX ix_cajas_tarima ON cajas(id_tarima);
