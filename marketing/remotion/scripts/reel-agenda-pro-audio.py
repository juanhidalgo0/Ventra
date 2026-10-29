"""Audio del reel de Agenda Pro: "That Good Feeling" (Pixabay, MarkJuly) recortado en compás, con
su final verdadero, y unos sonidos de interfaz muy suaves debajo. Sale a public/reel-agenda-pro/audio.wav.

    python scripts/reel-agenda-pro-audio.py

Los números salen de src/reel-agenda-pro/guion.ts (100 bpm, primer golpe a 0,29 s, 12 compases).
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

g = open(os.path.join(RAIZ, "src", "reel-agenda-pro", "guion.ts"), encoding="utf-8").read()
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


poner(swoosh(), s(t(4) + 4), 0.05)             # entra el celular de la clienta
poner(pop(), s(t(5)), 0.22)                     # llega el recordatorio
poner(pop(), s(t(5, 1)), 0.08)
poner(tap(), s(t(6, 1)), 0.35)                  # toca "Confirmo"
poner(pop(), s(t(6, 2)), 0.16)                  # se envía
poner(swoosh(0.28), s(t(7) - 2), 0.05)          # cambia al celular de la dueña
poner(campanita(), s(t(7, 1)), 0.18)            # aviso "Turno confirmado"
for i in range(5):                              # cada "Confirmó por WhatsApp" que se marca
    poner(nota(2093 + i * 120, 0.12, 30), s(t(8, 1) + i * 9), 0.05)

salida = mezcla + fx[:, None]
pico = np.abs(salida).max()
if pico > 0.98:
    salida *= 0.98 / pico
crudo = os.path.join(os.environ.get("TEMP", "."), "agenda-pro-crudo.wav")
wavfile.write(crudo, SR, (salida * 32767).astype(np.int16))
destino = os.path.join(RAIZ, "public", "reel-agenda-pro", "audio.wav")
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", crudo, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), destino], check=True)
print("listo:", destino, f"{N / SR:.2f} s")
