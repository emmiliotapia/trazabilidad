// Protocolo binario sobre LoRa (versión 1), versión C++ para el ESP32.
// Es la copia byte a byte de simulador/src/protocolo/trama.js: si cambias uno, cambia el otro
// y corre la prueba de paridad (firmware/paridad/comparar.py).
//
//  Cabecera (5 bytes)  [0] versión<<4 | tipo   [1..2] nodo (uint16 BE)   [3..4] seq (uint16 BE)
//  Cuerpo según tipo   (los enteros van en big-endian: el byte más significativo primero)
//  Campos variables    TLV: [tag][largo][valor]
//  Firma (4 bytes)     HMAC-SHA256(clave_del_nodo, cabecera+cuerpo), primeros 4 bytes
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace trama {

const uint8_t VERSION = 1;
const size_t MAX_TRAMA = 200;
const size_t LARGO_FIRMA = 4;
const size_t LARGO_CLAVE = 32;

enum Tipo : uint8_t { EVENTO = 1, ESTADO = 2, ACK = 3, CMD = 4, CMD_ACK = 5 };

// Resultado de un gate: 0 = PASS, cualquier otro valor = código de falla
enum Falla : uint8_t {
  PASS = 0, CERTIFICADO_INVALIDO = 1, GATE_PREVIO_NO_PASS = 2, RESINA_INCORRECTA = 3, OT_NO_ASIGNADA = 4,
  OPERADOR_NO_HABILITADO = 5, QR_MAQUINA_INCORRECTO = 6, NODO_BLOQUEADO = 7, PESO_FUERA_TOLERANCIA = 8,
  SECUENCIA_ROTA = 9, DEFECTO_CRITICO = 10, BOLSA_OTRA_OT = 11, DUPLICADO = 12, CAJA_LLENA = 13,
  CAJA_INCOMPLETA = 14, CAJA_SIN_ENCINTAR = 15, SKU_NO_COINCIDE = 16, TARIMA_INCOMPLETA = 17, CAMARA_NO_CONFIRMA = 18,
};

enum Comando : uint8_t { CARGAR_OT = 1, DESBLOQUEAR = 2, FIN_OT = 3, CARGAR_FORMULA = 4 };

// Campos TLV (mismo número de tag que CAMPOS en trama.js)
enum TipoCampo : uint8_t { TEXTO, U8, U16, LISTA };
struct DefCampo { uint8_t tag; const char *nombre; TipoCampo tipo; };
enum Campo : uint8_t {
  OT = 1, OPERADOR = 2, MAQUINA = 3, LOTE = 4, BOLSA = 5, TOTAL = 6, PESO = 7, CAJA = 8, POSICION = 9,
  SKU_RESINA = 10, EMBUDO = 11, TARIMA = 12, CARA = 13, CAMARA = 14, UBICACION = 15, PUERTA = 16,
  CANTIDAD = 17, CHAROLA = 18, DEFECTO = 19, PESO_NOMINAL = 20, TOLERANCIA = 21, OPERADORES = 22,
  SKU_PRODUCTO = 23, ORDEN = 24, NUMERO_PARTE = 25, PROVEEDOR = 26, CIERRE = 27,
};
const DefCampo *defCampo(uint8_t tag); // nullptr si el tag no existe

// Clave de cada nodo: HMAC-SHA256(claveRed, "nodo:<id>")
void claveNodo(const char *claveRed, uint16_t nodo, uint8_t clave[LARGO_CLAVE]);

// ───────── armar una trama ─────────
//   Escritor t(EVENTO, 106, seq);
//   t.u8(6); t.u8(PASS); t.u32(ts);          // cuerpo fijo del tipo
//   t.texto(OT, "OT-2611-042");              // campos TLV
//   size_t n = t.firmar(clave);              // agrega la firma; t.datos() tiene los bytes
class Escritor {
 public:
  Escritor(Tipo tipo, uint16_t nodo, uint16_t seq);
  void u8(uint8_t v);
  void u16(uint16_t v);
  void u32(uint32_t v);
  void texto(Campo c, const char *v);  // también sirve para LISTA ("E1023,E1044")
  void campoU8(Campo c, uint8_t v);
  void campoU16(Campo c, uint16_t v);
  size_t firmar(const uint8_t clave[LARGO_CLAVE]); // 0 si la trama no cupo
  const uint8_t *datos() const { return buf_; }
  size_t largo() const { return n_; }
  bool ok() const { return ok_; }

 private:
  uint8_t buf_[MAX_TRAMA];
  size_t n_ = 0;
  bool ok_ = true;
  void poner(const uint8_t *p, size_t largo);
};

// ───────── leer una trama ─────────
struct Leida {
  bool ok = false;
  const char *error = nullptr; // "TRAMA_CORTA", "VERSION", "FIRMA"
  uint8_t version = 0, tipo = 0;
  uint16_t nodo = 0, seq = 0;
  const uint8_t *cuerpo = nullptr; // sin cabecera ni firma
  size_t largoCuerpo = 0;
};
bool leerCabecera(const uint8_t *buf, size_t largo, Leida &out); // no revisa la firma
Leida leer(const uint8_t *buf, size_t largo, const uint8_t clave[LARGO_CLAVE]);

// Recorre los campos TLV a partir de p. Devuelve false al terminar.
//   const uint8_t *p = ...; uint8_t tag, n; const uint8_t *v;
//   while (trama::siguienteCampo(p, fin, tag, v, n)) { ... }
bool siguienteCampo(const uint8_t *&p, const uint8_t *fin, uint8_t &tag, const uint8_t *&valor, uint8_t &largo);

uint16_t leerU16(const uint8_t *p);
uint32_t leerU32(const uint8_t *p);

} // namespace trama
