#include "trama.h"
#include <stdio.h>
#include <string.h>
#include "mbedtls/md.h"

namespace trama {

static const DefCampo CAMPOS[] = {
  {OT, "ot", TEXTO}, {OPERADOR, "operador", TEXTO}, {MAQUINA, "maquina", TEXTO}, {LOTE, "lote", TEXTO},
  {BOLSA, "bolsa", U16}, {TOTAL, "total", U16}, {PESO, "peso", U16}, {CAJA, "caja", TEXTO},
  {POSICION, "posicion", U8}, {SKU_RESINA, "skuResina", TEXTO}, {EMBUDO, "embudo", TEXTO},
  {TARIMA, "tarima", TEXTO}, {CARA, "cara", U8}, {CAMARA, "camara", U8}, {UBICACION, "ubicacion", TEXTO},
  {PUERTA, "puerta", TEXTO}, {CANTIDAD, "cantidad", U16}, {CHAROLA, "charola", U8}, {DEFECTO, "defecto", U8},
  {PESO_NOMINAL, "pesoNominal", U16}, {TOLERANCIA, "tolerancia", U16}, {OPERADORES, "operadores", LISTA},
  {SKU_PRODUCTO, "skuProducto", TEXTO}, {ORDEN, "orden", TEXTO}, {NUMERO_PARTE, "numeroParte", TEXTO},
  {PROVEEDOR, "proveedor", TEXTO}, {CIERRE, "cierre", U8},
};

const DefCampo *defCampo(uint8_t tag) {
  for (const auto &c : CAMPOS)
    if (c.tag == tag) return &c;
  return nullptr;
}

static void hmac(const uint8_t *clave, size_t largoClave, const uint8_t *datos, size_t largo, uint8_t out[32]) {
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), clave, largoClave, datos, largo, out);
}

void claveNodo(const char *claveRed, uint16_t nodo, uint8_t clave[LARGO_CLAVE]) {
  char texto[16];
  int n = snprintf(texto, sizeof texto, "nodo:%u", nodo);
  hmac((const uint8_t *)claveRed, strlen(claveRed), (const uint8_t *)texto, n, clave);
}

uint16_t leerU16(const uint8_t *p) { return (uint16_t)(p[0] << 8 | p[1]); }
uint32_t leerU32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }

// ───────── Escritor ─────────
Escritor::Escritor(Tipo tipo, uint16_t nodo, uint16_t seq) {
  u8((VERSION << 4) | tipo);
  u16(nodo);
  u16(seq);
}

void Escritor::poner(const uint8_t *p, size_t largo) {
  if (n_ + largo + LARGO_FIRMA > MAX_TRAMA) {
    ok_ = false;
    return;
  }
  memcpy(buf_ + n_, p, largo);
  n_ += largo;
}

void Escritor::u8(uint8_t v) { poner(&v, 1); }
void Escritor::u16(uint16_t v) {
  uint8_t b[2] = {(uint8_t)(v >> 8), (uint8_t)v};
  poner(b, 2);
}
void Escritor::u32(uint32_t v) {
  uint8_t b[4] = {(uint8_t)(v >> 24), (uint8_t)(v >> 16), (uint8_t)(v >> 8), (uint8_t)v};
  poner(b, 4);
}

void Escritor::texto(Campo c, const char *v) {
  size_t largo = strlen(v);
  if (largo > 255) {
    ok_ = false;
    return;
  }
  uint8_t cab[2] = {c, (uint8_t)largo};
  poner(cab, 2);
  poner((const uint8_t *)v, largo);
}

void Escritor::campoU8(Campo c, uint8_t v) {
  uint8_t b[3] = {c, 1, v};
  poner(b, 3);
}

void Escritor::campoU16(Campo c, uint16_t v) {
  uint8_t b[4] = {c, 2, (uint8_t)(v >> 8), (uint8_t)v};
  poner(b, 4);
}

size_t Escritor::firmar(const uint8_t clave[LARGO_CLAVE]) {
  if (!ok_) return 0;
  uint8_t h[32];
  hmac(clave, LARGO_CLAVE, buf_, n_, h);
  memcpy(buf_ + n_, h, LARGO_FIRMA); // poner() ya dejó espacio para la firma
  n_ += LARGO_FIRMA;
  return n_;
}

// ───────── lectura ─────────
bool leerCabecera(const uint8_t *buf, size_t largo, Leida &out) {
  if (largo < 9) {
    out.error = "TRAMA_CORTA";
    return false;
  }
  out.version = buf[0] >> 4;
  out.tipo = buf[0] & 0x0f;
  out.nodo = leerU16(buf + 1);
  out.seq = leerU16(buf + 3);
  return true;
}

Leida leer(const uint8_t *buf, size_t largo, const uint8_t clave[LARGO_CLAVE]) {
  Leida m;
  if (!leerCabecera(buf, largo, m)) return m;
  if (m.version != VERSION) {
    m.error = "VERSION";
    return m;
  }
  uint8_t h[32];
  hmac(clave, LARGO_CLAVE, buf, largo - LARGO_FIRMA, h);
  uint8_t dif = 0; // comparar todos los bytes, sin salir antes (igual que timingSafeEqual)
  for (size_t i = 0; i < LARGO_FIRMA; i++) dif |= h[i] ^ buf[largo - LARGO_FIRMA + i];
  if (dif) {
    m.error = "FIRMA";
    return m;
  }
  m.ok = true;
  m.cuerpo = buf + 5;
  m.largoCuerpo = largo - 5 - LARGO_FIRMA;
  return m;
}

bool siguienteCampo(const uint8_t *&p, const uint8_t *fin, uint8_t &tag, const uint8_t *&valor, uint8_t &largo) {
  if (p + 2 > fin) return false;
  tag = p[0];
  largo = p[1];
  valor = p + 2;
  if (valor + largo > fin) return false; // campo cortado
  p = valor + largo;
  return true;
}

} // namespace trama
