"""Audio del reel "El precio viaja solo" (Ventra + GO): "That Good Feeling" (Pixabay, MarkJuly) recortado en
compás, con su final verdadero, y sonidos de interfaz muy suaves debajo. Sale a public/reel-go/audio.wav.

    python scripts/reel-go-audio.py

Los números salen de src/reel-go/guion.ts (100 bpm, primer golpe a 0,29 s, 12 compases).
"""
import os
import re
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
SR = 48000

g = open(os.path.join(RAIZ, "src", "reel-go", "guion.ts"), encoding="utf-8").read()
num = lambda nombre: float(re.search(rf"export const {nombre} = ([\d.]+)", g).group(1))
FPS, GOLPE, CUERPO = num("FPS"), num("GOLPE"), num("COMPASES_CUERPO")
FINAL_DESDE, FINAL_DURA = num("FINAL_DESDE"), num("FINAL_DURA")
PRIMER = 0.29
COMPAS_S = 4 * GOLPE / FPS

# ── Música: decodificar y cortar ─────────────────────────────────────────────────
tmp = os.path.join(os.environ.get("TEMP", "."), "musica-48k.wav")
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", os.path.join(RAIZ, "public", "musica.mp3"), "-ar", str(SR), "-ac", "2", tmp], check=True)
_, m = wavfile.read(tmp)
m = m.astype(np.float64) / 32768

corte = int((PRIMER + CUERPO * COMPAS_S) * SR)  # justo en el compás 12
desde = int(FINAL_DESDE * SR)
cola = m[desde:desde + int(FINAL_DURA * SR)].copy()
cuerpo = m[:corte].copy()
x = int(0.012 * SR)  # fundido cruzado cortito para que el empalme no haga clic
rampa = np.linspace(0, 1, x)[:, None]
mezcla = np.concatenate([cuerpo[:-x], cuerpo[-x:] * (1 - rampa) + cola[:x] * rampa, cola[x:]])
fin = int(0.6 * SR)
mezcla[-fin:] *= np.linspace(1, 0, fin)[:, None] ** 2
N = len(mezcla)


def s(frame):
    return int(round(frame / FPS * SR))


def t(c, golpe=0):
    return round(PRIMER * FPS + c * 4 * GOLPE + golpe * GOLPE)


def filtro(sig, tipo, f):
    return sosfilt(butter(2, f, btype=tipo, fs=SR, output="sos"), sig)


rng = np.random.default_rng(7)
fx = np.zeros(N)


def poner(sig, en, vol):
    a, b = max(0, en), min(N, en + len(sig))
    if b > a:
        fx[a:b] += sig[: b - a] * vol


def nota(freq, dur, caida):
    tt = np.arange(int(dur * SR)) / SR
    return np.sin(2 * np.pi * freq * tt) * np.exp(-tt * caida) * np.minimum(1, tt / 0.003)


def pop():  # llega un mensaje
    tt = np.arange(int(0.09 * SR)) / SR
    return np.sin(2 * np.pi * np.cumsum(900 + 700 * np.exp(-tt * 40)) / SR) * np.exp(-tt * 38)


def tap():  # toque en la pantalla
    return filtro(rng.standard_normal(int(0.03 * SR)), "band", [1200, 5000]) * np.exp(-np.arange(int(0.03 * SR)) / SR * 220)


def swoosh(dur=0.32):
    n = int(dur * SR)
    return filtro(rng.standard_normal(n), "band", [500, 3500]) * np.sin(np.linspace(0, np.pi, n)) ** 2


def campanita():  # aviso al celular de la dueña
    return nota(1318.5, 0.7, 7) * 0.8 + np.pad(nota(1975.5, 0.8, 6), (int(0.09 * SR), 0))[: int(0.7 * SR)] * 0.7




def caja():  # cobro en la caja: dos notas cortas, como el pitido del ticket
    return np.pad(nota(1760, 0.09, 30), (0, int(0.15 * SR))) + np.pad(nota(2349, 0.16, 22), (int(0.08 * SR), 0))


poner(nota(1568, 0.08, 40), s(t(1, 2)), 0.06)    # cambia el precio
poner(tap(), s(t(2, 2)), 0.35)                    # "Guardar cambios"
poner(swoosh(), s(t(3) - 2), 0.05)                # se va el monitor, entra el celular
poner(pop(), s(t(4)), 0.2)                        # en GO ya figura $4.100
poner(tap(), s(t(6, 1)), 0.3)                     # el vecino suma la Coca
poner(tap(), s(t(6, 2)), 0.3)                     # y el agua
poner(pop(), s(t(6, 3)), 0.12)
poner(swoosh(0.28), s(t(7) - 2), 0.05)            # vuelve la caja
poner(campanita(), s(t(7, 1)), 0.2)               # entra el pedido de GO
poner(tap(), s(t(8, 3) + 6), 0.35)                # "Cobrar en la caja"
poner(caja(), s(t(9)), 0.12)                      # el ticket cargado
salida = mezcla + fx[:, None]
pico = np.abs(salida).max()
if pico > 0.98:
    salida *= 0.98 / pico
crudo = os.path.join(os.environ.get("TEMP", "."), "reel-go-crudo.wav")
wavfile.write(crudo, SR, (salida * 32767).astype(np.int16))
destino = os.path.join(RAIZ, "public", "reel-go", "audio.wav")
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", crudo, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), destino], check=True)
print("listo:", destino, f"{N / SR:.2f} s")
