"""Puente entre el puerto USB del gateway LoRa y el simulador (lo arranca src/radio/gateway-serie.js).

  Lo que llega del gateway  → se imprime tal cual (líneas "RX <hex> <rssi> <snr>")
  Lo que llega por stdin    → se escribe al gateway (líneas "TX <hex>")

Se usa Python (pyserial) porque la librería serialport de Node 26 en Windows no entrega
los datos recibidos a tiempo (ver firmware/README.md).
"""
import os
import sys
import threading

import serial

if len(sys.argv) < 2:
    sys.exit("Uso: python serie.py COM9")

try:
    puerto = serial.Serial(sys.argv[1], 115200, timeout=0.05)
except serial.SerialException as e:
    sys.exit(f"No se pudo abrir {sys.argv[1]}: {e}")


def leer_placa():
    resto = b""
    while True:
        try:
            resto += puerto.read(512)
        except serial.SerialException as e:
            # USB desconectado: se termina el proceso y el simulador lo vuelve a abrir
            print(f"ERROR puerto: {e}", file=sys.stderr, flush=True)
            os._exit(1)
        while b"\n" in resto:
            linea, resto = resto.split(b"\n", 1)
            texto = linea.decode("latin1").strip()
            if texto:
                print(texto, flush=True)


threading.Thread(target=leer_placa, daemon=True).start()
print(f"ABIERTO {sys.argv[1]}", flush=True)

for linea in sys.stdin:
    linea = linea.strip()
    if linea:
        try:
            puerto.write((linea + "\n").encode("ascii"))
        except serial.SerialException as e:
            print(f"ERROR puerto: {e}", file=sys.stderr, flush=True)
            os._exit(1)
