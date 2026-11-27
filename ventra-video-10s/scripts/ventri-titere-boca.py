# Boca del títere: decide, cuadro por cuadro, qué boca tiene Ventri según la voz, y lo guarda en el guion.
#
#   python scripts/ventri-titere-boca.py src/ventri/cortos/corto-01.json
#
# Arma la pista de voz igual que ventri-mezcla.py (cada frase de "voz.frases" cortada del archivo entre
# "desde" y "hasta" y puesta en su cuadro "en") y, para cada cuadro, mira el volumen y el brillo del sonido:
#   "-" cerrada (la base) · "c" chica · "a" bien abierta · "o" redonda · "e" con dientes
# Sin silencio no hay boca cerrada, así que en las pausas cierra; una boca dura al menos 2 cuadros para que
# no "tiemble". Escribe guion["boca"] (un texto con un carácter por cuadro). Gratis: no usa ninguna IA.
import json
import os
import subprocess
import sys

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
SR = 22050


def leer(ruta):
    b = subprocess.run([FFMPEG, "-v", "error", "-i", ruta, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(b, np.float32)


def main():
    ruta = sys.argv[1]
    G = json.load(open(ruta, encoding="utf-8"))
    fps, total = G["fps"], G["total"]
    toma = leer(os.path.join(RAIZ, G["voz"]["archivo"]))
    voz = np.zeros(int(total / fps * SR) + SR, np.float32)
    for fr in G["voz"]["frases"]:
        a, b = int(fr["desde"] * SR), int(fr["hasta"] * SR)
        i = int(fr["en"] / fps * SR)
        trozo = toma[a:b][: len(voz) - i]
        voz[i:i + len(trozo)] += trozo
    paso = SR // fps
    win = int(SR * 0.045)
    nivel, brillo = np.zeros(total), np.zeros(total)
    for k in range(total):
        c = k * paso + paso // 2
        x = voz[max(0, c - win // 2): c + win // 2]
        if len(x) < 16:
            continue
        nivel[k] = 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
        esp = np.abs(np.fft.rfft(x * np.hanning(len(x))))
        fq = np.fft.rfftfreq(len(x), 1 / SR)
        brillo[k] = (esp * fq).sum() / (esp.sum() + 1e-9)
    ref = np.percentile(nivel[nivel > -60], 95) if (nivel > -60).any() else -20
    rel = nivel - ref
    activos = rel > -26
    corte_e = np.percentile(brillo[activos], 70) if activos.any() else 3000
    corte_o = np.percentile(brillo[activos], 22) if activos.any() else 1200
    # la voz viene comprimida (casi todo suena fuerte): los cortes van por percentiles de lo que suena,
    # así no queda la boca abierta al máximo todo el tiempo (parece que grita)
    bajo = np.percentile(rel[activos], 35) if activos.any() else -12
    alto = np.percentile(rel[activos], 78) if activos.any() else -4
    boca = []
    for k in range(total):
        if not activos[k]:
            boca.append("-")
        elif rel[k] < bajo:
            boca.append("c")
        elif rel[k] >= alto:
            boca.append("e" if brillo[k] >= corte_e else "a")
        elif brillo[k] >= corte_e:
            boca.append("e")
        elif brillo[k] <= corte_o:
            boca.append("o")
        else:
            boca.append("c")
    # mínimo 2 cuadros por boca
    for k in range(1, total - 1):
        if boca[k] != boca[k - 1] and boca[k] != boca[k + 1]:
            boca[k] = boca[k - 1]
    G["boca"] = "".join(boca)
    json.dump(G, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    cuenta = {s: G["boca"].count(s) for s in "-caoe"}
    print("boca lista:", cuenta)


if __name__ == "__main__":
    main()
