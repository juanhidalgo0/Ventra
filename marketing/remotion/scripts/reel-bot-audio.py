"""Audio del reel "Mi kiosco me contesta": la voz en off (public/reel-bot/voz.wav, armada con las 6
frases de ElevenLabs desde Katana) adelante, la música ("That Good Feeling", Pixabay) baja y que se
corre cuando habla la voz, y sonidos de WhatsApp sintetizados en los cuadros de src/reel-bot/guion.json.

    python scripts/reel-bot-audio.py
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
G = json.load(open(os.path.join(RAIZ, "src", "reel-bot", "guion.json"), encoding="utf-8"))
FPS, TOTAL = G["fps"], G["total"]
N = int(TOTAL / FPS * SR)
TMP = os.environ.get("TEMP", ".")


def leer(ruta, nombre):
    out = os.path.join(TMP, nombre)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", ruta, "-ar", str(SR), "-ac", "2", out], check=True)
    _, a = wavfile.read(out)
    a = a.astype(np.float64) / 32768
    a = a[:N]
    return np.pad(a, ((0, N - len(a)), (0, 0)))


voz = leer(os.path.join(RAIZ, "public", "reel-bot", "voz.wav"), "reel-bot-voz.wav")
musica = leer(os.path.join(RAIZ, "public", "musica.mp3"), "reel-bot-musica.wav")

# ── La música se corre cuando habla la voz (envolvente de la voz suavizada) ──
env = np.abs(voz).max(axis=1)
k = int(0.25 * SR)
env = np.convolve(env, np.ones(k) / k, mode="same")
habla = np.clip(env / (env.max() * 0.25), 0, 1)
vol = 0.32 - 0.20 * habla  # ≈ -10 dB sin voz, ≈ -20 dB con voz
ini, fin = int(0.4 * SR), int(1.2 * SR)
vol[:ini] *= np.linspace(0, 1, ini)
vol[-fin:] *= np.linspace(1, 0, fin) ** 2
musica *= vol[:, None]


# ── Sonidos de interfaz ──
def s(frame):
    return int(round(frame / FPS * SR))


def filtro(sig, tipo, f):
    return sosfilt(butter(2, f, btype=tipo, fs=SR, output="sos"), sig)


rng = np.random.default_rng(11)
fx = np.zeros(N)


def poner(sig, en, v):
    a, b = max(0, en), min(N, en + len(sig))
    if b > a:
        fx[a:b] += sig[: b - a] * v


def pop():  # llega un mensaje
    tt = np.arange(int(0.09 * SR)) / SR
    return np.sin(2 * np.pi * np.cumsum(900 + 700 * np.exp(-tt * 40)) / SR) * np.exp(-tt * 38)


def envia():  # sale un mensaje (más grave y corto)
    tt = np.arange(int(0.07 * SR)) / SR
    return np.sin(2 * np.pi * np.cumsum(520 + 380 * np.exp(-tt * 50)) / SR) * np.exp(-tt * 45)


def tap():
    return filtro(rng.standard_normal(int(0.03 * SR)), "band", [1200, 5000]) * np.exp(-np.arange(int(0.03 * SR)) / SR * 220)


def swoosh(dur=0.34):
    n = int(dur * SR)
    return filtro(rng.standard_normal(n), "band", [500, 3500]) * np.sin(np.linspace(0, np.pi, n)) ** 2


S = G["sonidos"]
for f in S["envia"]:
    poner(envia(), s(f), 0.16)
for f in S["llega"]:
    poner(pop(), s(f), 0.20)
for f in S["toque"]:
    poner(tap(), s(f), 0.35)
for f in S["whoosh"]:
    poner(swoosh(), s(f), 0.06)

salida = voz * 1.0 + musica + fx[:, None]
pico = np.abs(salida).max()
if pico > 0.98:
    salida *= 0.98 / pico
crudo = os.path.join(TMP, "reel-bot-crudo.wav")
wavfile.write(crudo, SR, (salida * 32767).astype(np.int16))
destino = os.path.join(RAIZ, "public", "reel-bot", "audio.wav")
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", crudo, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), destino], check=True)
print("listo:", destino, f"{N / SR:.2f} s")
