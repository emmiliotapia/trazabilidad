"""Lector de códigos USB → terminal ESP32 por su cable USB.

  python escaner.py COM7

Deje esta ventana activa y escanee: el lector "teclea" el código y Enter, y aquí se manda a la placa.
Abajo se ve lo que contesta la terminal (PASS / FAIL y el mensaje de su pantalla). Ctrl+C para salir.
No reinicia la placa al abrir el puerto (si se reiniciara, perdería la OT cargada).
"""
import sys
import threading

import serial

sys.stdout.reconfigure(encoding="utf-8")
if len(sys.argv) < 2:
    sys.exit("Uso: python escaner.py COM7")

placa = serial.Serial(sys.argv[1], 115200, timeout=0.1)


def mostrar_respuestas():
    resto = b""
    while True:
        resto += placa.read(512)
        while b"\n" in resto:
            linea, resto = resto.split(b"\n", 1)
            texto = linea.decode("latin1").strip()
            if texto:
                print(f"   terminal: {texto}", flush=True)


threading.Thread(target=mostrar_respuestas, daemon=True).start()
print(f"Conectado a la terminal en {sys.argv[1]}. Escanee (o escriba un código y Enter).")
try:
    for linea in sys.stdin:
        codigo = linea.strip()
        if codigo:
            placa.write((codigo + "\n").encode("latin1"))
except KeyboardInterrupt:
    pass
