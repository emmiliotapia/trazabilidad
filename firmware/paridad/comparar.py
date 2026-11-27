"""Prueba de paridad: ¿el ESP32 arma y lee las tramas exactamente igual que trama.js?

  1. Subir este firmware:      pio run -t upload --upload-port COM7
  2. Correr la comparación:    python comparar.py COM7

Los ejemplos esperados los calcula el simulador (simulador/herramientas/vectores-paridad.mjs),
así trama.js sigue siendo la única referencia. Aquí solo se habla con la placa por el puerto USB.
Necesita pyserial (viene instalado con PlatformIO).
"""
import json
import pathlib
import subprocess
import sys
import time

import serial

sys.stdout.reconfigure(encoding="utf-8")

if len(sys.argv) < 2:
    sys.exit("Uso: python comparar.py COM7")

simulador = pathlib.Path(__file__).resolve().parents[2] / "simulador"
vectores = json.loads(
    subprocess.run(["node", "herramientas/vectores-paridad.mjs"], cwd=simulador, capture_output=True, encoding="utf-8", check=True).stdout
)

placa = serial.Serial(sys.argv[1], 115200, timeout=0.2)


def leer_lineas(hasta, segundos=4.0):
    """Lee líneas hasta encontrar una que cumpla `hasta`; devuelve todas las leídas."""
    lineas, resto, fin = [], b"", time.time() + segundos
    while time.time() < fin:
        resto += placa.read(512)
        while b"\n" in resto:
            linea, resto = resto.split(b"\n", 1)
            linea = linea.decode("latin1").strip()
            if linea:
                lineas.append(linea)
                if hasta(linea):
                    return lineas
    return lineas


# Reiniciar la placa y esperar a que diga LISTO
placa.dtr = False
placa.rts = True
time.sleep(0.1)
placa.rts = False
if not any(l.startswith("LISTO") for l in leer_lineas(lambda l: l.startswith("LISTO"))):
    sys.exit("La placa no dijo LISTO: ¿tiene cargado firmware/paridad y es el puerto correcto?")

fallas = 0

print("\nSubida: tramas que arma el ESP32 contra las de trama.js\n")
placa.write(b"E\n")
recibidas = {}
for l in leer_lineas(lambda l: l == "FIN"):
    if l.startswith("V") and " " in l:
        num, hexa = l.split(" ", 1)
        recibidas[int(num[1:])] = hexa
for i, v in enumerate(vectores["subida"], start=1):
    esp = recibidas.get(i, "(no llegó)")
    ok = esp == v["hex"]
    fallas += not ok
    print(f"{'OK ' if ok else 'MAL'} {v['nombre']} ({len(v['hex']) // 2} bytes)")
    if not ok:
        print(f"    ESP32:    {esp}\n    trama.js: {v['hex']}")

print("\nBajada: tramas de trama.js que lee el ESP32\n")
for v in vectores["bajada"]:
    placa.write(f"D {v['hex']}\n".encode())
    lineas = leer_lineas(lambda l: l.startswith("D "))
    esp = lineas[-1] if lineas else "(no contestó)"
    ok = esp == v["espera"]
    fallas += not ok
    print(f"{'OK ' if ok else 'MAL'} {v['nombre']}")
    if not ok:
        print(f"    ESP32:    {esp}\n    esperado: {v['espera']}")

placa.close()
print(f"\n{fallas} diferencia(s). Revisar firmware/lib/trama.\n" if fallas else "\nTodo igual: el ESP32 habla el mismo protocolo que el simulador.\n")
sys.exit(1 if fallas else 0)
