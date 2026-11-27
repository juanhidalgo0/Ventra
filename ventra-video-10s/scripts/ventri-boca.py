# Corta la voz final de Ventri (ya pasada por ventri-voz.py) en pedazos para las tomas con boca (Wan 2.7).
#
#   python scripts/ventri-boca.py VOZ.mp3 CARPETA_SALIDA  id:desde-hasta  id:desde-hasta ...
#   ej.: python scripts/ventri-boca.py ../marketing/ventri/ep02/voz/procesadas/toma-1-ventri.mp3 \
#           ../marketing/ventri/ep02/voz/wan  s1:0-5.9  s2:5.9-8.6
#
# Igual que en el ep. 1 (biblia, punto 4.3): cada pedazo lleva 0,3 s de silencio adelante y se rellena
# con silencio hasta un largo entero de segundos (Wan pide 2 a 15 s). Los cortes se corren solos al
# punto más silencioso a ±0,12 s del tiempo pedido, así no se come una sílaba.
# Escribe id.wav (44,1 kHz mono, el que se sube a Wan) e imprime el largo de cada uno y los créditos
# (1,5 por segundo en 720p) para pedir el costo antes de generar.
import math
import os
import subprocess
import sys
import numpy as np
from scipy.io import wavfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
SR = 44100
SILENCIO_ADELANTE = 0.3
BUSCAR = 0.12


def main():
    voz, carpeta, cortes = sys.argv[1], sys.argv[2], sys.argv[3:]
    crudo = subprocess.run([FFMPEG, "-v", "error", "-i", voz, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                           capture_output=True, check=True).stdout
    x = np.frombuffer(crudo, np.float32).copy()
    h = int(0.01 * SR)
    k = len(x) // h
    e = np.sqrt((x[:k * h].reshape(k, h) ** 2).mean(1))

    def ajustar(t):
        if t <= 0:
            return 0.0
        if t >= len(x) / SR:
            return len(x) / SR
        a, b = max(0, int((t - BUSCAR) / 0.01)), min(k, int((t + BUSCAR) / 0.01) + 1)
        return (a + int(np.argmin(e[a:b]))) * 0.01 + 0.005

    os.makedirs(carpeta, exist_ok=True)
    total = 0
    for c in cortes:
        nombre, rango = c.split(":")
        d, hst = (float(v) for v in rango.split("-"))
        d, hst = ajustar(d), ajustar(hst)
        trozo = x[int(d * SR):int(hst * SR)].copy()
        n = int(0.01 * SR)
        trozo[:n] *= np.linspace(0, 1, n)
        trozo[-n:] *= np.linspace(1, 0, n)
        largo = SILENCIO_ADELANTE + len(trozo) / SR
        seg = max(2, math.ceil(largo - 1e-6))
        sal = np.zeros(int(seg * SR), np.float32)
        i = int(SILENCIO_ADELANTE * SR)
        sal[i:i + len(trozo)] = trozo
        wavfile.write(os.path.join(carpeta, nombre + ".wav"), SR, (np.clip(sal, -1, 1) * 32767).astype(np.int16))
        total += seg
        print(f"{nombre}: voz {d:.2f}-{hst:.2f} s ({len(trozo) / SR:.2f} s) -> {seg} s de toma, {seg * 1.5:.1f} créditos")
    print(f"total: {total} s, {total * 1.5:.1f} créditos")


if __name__ == "__main__":
    main()
