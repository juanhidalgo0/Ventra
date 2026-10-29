"""Audio del reel "Un pedido real en Kiosco Paulos": la música recortada en compás con su final verdadero
y, muy bajos debajo, los toques de pantalla (los mismos que marca el video), el aviso del pedido en la caja,
el cobro y la entrega. Sale a public/reel-paulos/audio.wav.

    python scripts/reel-paulos-audio.py

Los tiempos salen de src/reel-paulos/guion.json y de las tomas en public/reel-paulos/tomas/*.json.
La música es public/musica.mp3 (cambiarla por otra = otro archivo y los números del guion).
"""
import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
SR = 48000

G = json.load(open(os.path.join(RAIZ, "src", "reel-paulos", "guion.json"), encoding="utf-8"))
FPS, GOLPE = G["fps"], G["golpe"]
COMPAS = 4 * GOLPE
PRIMER = G["primerGolpe"]
TOMAS = {n: json.load(open(os.path.join(RAIZ, "public", "reel-paulos", "tomas", f"{n}.json"), encoding="utf-8")) for n in ("pedido", "caja", "seguimiento")}


def t(c, g=0):
    return round(PRIMER * FPS + c * COMPAS + g * GOLPE)


TOTAL = round(PRIMER * FPS + G["compasesCuerpo"] * COMPAS + G["finalDura"] * FPS)
E = {k: (t(a), min(t(b), TOTAL)) for k, (a, b) in G["escenas"].items()}

# ── Música: el tema hasta el último compás del cuerpo y después su compás final ──────
tmp = os.path.join(os.environ.get("TEMP", "."), "musica-48k.wav")
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", os.path.join(RAIZ, "public", "musica.mp3"), "-ar", str(SR), "-ac", "2", tmp], check=True)
_, m = wavfile.read(tmp)
m = m.astype(np.float64) / 32768
corte = int((PRIMER + G["compasesCuerpo"] * COMPAS / FPS) * SR)
desde = int(G["finalDesde"] * SR)
cola = m[desde:desde + int(G["finalDura"] * SR)].copy()
cuerpo = m[:corte].copy()
x = int(0.012 * SR)
rampa = np.linspace(0, 1, x)[:, None]
mezcla = np.concatenate([cuerpo[:-x], cuerpo[-x:] * (1 - rampa) + cola[:x] * rampa, cola[x:]])
fin = int(0.6 * SR)
mezcla[-fin:] *= np.linspace(1, 0, fin)[:, None] ** 2
mezcla *= 0.85  # la música un poco más abajo: acá cuentan los sonidos de la app
N = len(mezcla)


def s(frame):
    return int(round(frame / FPS * SR))


def filtro(sig, tipo, f):
    return sosfilt(butter(2, f, btype=tipo, fs=SR, output="sos"), sig)


rng = np.random.default_rng(11)
fx = np.zeros(N)


def poner(sig, en, vol):
    a, b = max(0, en), min(N, en + len(sig))
    if b > a:
        fx[a:b] += sig[: b - a] * vol


def nota(freq, dur, caida):
    tt = np.arange(int(dur * SR)) / SR
    return np.sin(2 * np.pi * freq * tt) * np.exp(-tt * caida) * np.minimum(1, tt / 0.003)


def tap():
    n = int(0.03 * SR)
    return filtro(rng.standard_normal(n), "band", [1200, 5000]) * np.exp(-np.arange(n) / SR * 220)


def swoosh(dur=0.34):
    n = int(dur * SR)
    return filtro(rng.standard_normal(n), "band", [400, 3200]) * np.sin(np.linspace(0, np.pi, n)) ** 2


def campanita():
    a = nota(1318.5, 0.7, 7)
    return a * 0.8 + np.pad(nota(1975.5, 0.8, 6), (int(0.09 * SR), 0))[: len(a)] * 0.7


def cobro():  # dos notas cortas, como el pitido del ticket
    a = nota(1760, 0.09, 30)
    return np.pad(a, (0, int(0.15 * SR))) + np.pad(nota(2349, 0.16, 22), (int(0.08 * SR), 0))


def listo():  # acorde suave de "entregado"
    return sum(np.pad(nota(f, 0.9, 4.5), (int(i * 0.06 * SR), 0))[: int(0.9 * SR)] for i, f in enumerate((1046.5, 1318.5, 1568.0)))


# Toques de cada clip, igual que en ReelPaulos.tsx
for escena in ("telefono", "caja", "seguimiento"):
    a = E[escena][0]
    for c in G["clips"][escena]:
        rate = (c["hasta"] - c["desde"]) * FPS / c["cuadros"]
        for q in TOMAS[c["toma"]]["toques"]:
            if c["desde"] <= q["t"] < c["hasta"] and "desliza" not in q:
                poner(tap(), s(a + (q["t"] - c["desde"]) * FPS / rate), 0.32)
        a += c["cuadros"]

for k in ("telefono", "caja", "seguimiento"):
    poner(swoosh(), s(E[k][0] - 4), 0.05)
poner(campanita(), s(E["caja"][0] + 8), 0.2)          # entra el pedido de GO en la caja
caja_clips = G["clips"]["caja"]
venta = E["caja"][0] + sum(c["cuadros"] for c in caja_clips[:3])
poner(cobro(), s(venta + 4), 0.14)                    # "¡Venta registrada!"
seg = G["clips"]["seguimiento"]
entregado = E["seguimiento"][0] + sum(c["cuadros"] for c in seg[:4])
poner(listo(), s(entregado + 2), 0.12)                 # "¡Pedido entregado!"
poner(swoosh(0.4), s(E["cierre"][0] - 4), 0.06)

salida = mezcla + fx[:, None]
pico = np.abs(salida).max()
if pico > 0.98:
    salida *= 0.98 / pico
crudo = os.path.join(os.environ.get("TEMP", "."), "reel-paulos-crudo.wav")
wavfile.write(crudo, SR, (salida * 32767).astype(np.int16))
destino = os.path.join(RAIZ, "public", "reel-paulos", "audio.wav")
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", crudo, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), destino], check=True)
print("listo:", destino, f"{N / SR:.2f} s")
