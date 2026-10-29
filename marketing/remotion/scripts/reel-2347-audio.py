"""Audio del reel "23:47": todo sintetizado (sin samples con derechos), con los tiempos de
src/reel-2347/guion.json. Sale a public/reel-2347/audio.wav normalizado a -14 LUFS.

    python scripts/reel-2347-audio.py
"""
import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
G = json.load(open(os.path.join(RAIZ, "src", "reel-2347", "guion.json"), encoding="utf-8"))
SR = 48000
FPS = G["fps"]
N = int(G["total"] / FPS * SR)
E = G["escenas"]
rng = np.random.default_rng(2347)

L = np.zeros(N)
R = np.zeros(N)


def s(frame):
    """Cuadro → muestra."""
    return int(frame / FPS * SR)


def filtro(x, tipo, f):
    return sosfilt(butter(2, f, btype=tipo, fs=SR, output="sos"), x)


def poner(x, en, vol=1.0, pan=0.0):
    """Suma x desde la muestra `en` (pan -1 izq … 1 der)."""
    a = max(0, en)
    b = min(N, en + len(x))
    if b <= a:
        return
    x = x[a - en:b - en] * vol
    L[a:b] += x * (1 - max(0, pan))
    R[a:b] += x * (1 + min(0, pan))


def env(n, ataque, caida):
    """Envolvente con ataque y caída en segundos."""
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(ataque, 1e-4))
    fin = n / SR
    return e * np.clip((fin - t) / max(caida, 1e-4), 0, 1)


def campana(freq, dur=0.9, brillo=0.35):
    """Nota tipo marimba suave: fundamental + parcial alto que se apaga rápido."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t * 5.5)
    x += brillo * np.sin(2 * np.pi * freq * 3.98 * t) * np.exp(-t * 22)
    return x * env(n, 0.004, 0.05)


def ruido_marron(n):
    x = np.cumsum(rng.standard_normal(n))
    x -= filtro(x, "low", 5)
    return x / (np.abs(x).max() + 1e-9)


# ── Ambiente de la habitación de noche (también en el negro, apenas) ─────────────
amb = filtro(ruido_marron(s(E["calma"][1])), "low", 380)
amb *= np.concatenate([np.ones(s(E["noche"][1])), np.full(s(E["calma"][1]) - s(E["noche"][1]), 0.6)])
poner(amb * env(len(amb), 0.6, 0.8), 0, 0.10)

# ── Zumbido grave de la noche, que se va tensando hasta el corte ─────────────────
n = s(E["noche"][1])
t = np.arange(n) / SR
dron = sum(np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * 0.07 * t)) * a for f, a in [(49, 1), (73.6, 0.6), (98.3, 0.35)])
sube = np.linspace(0.35, 1, n) ** 2
tension = np.sin(2 * np.pi * 1318 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 6 * t)) * np.clip((t - 8.6) / 2.2, 0, 1) * 0.12
dron = (dron * sube + tension) * env(n, 1.2, 0.005)  # corte seco en el negro
poner(dron, 0, 0.09)

# ── Vibración del celular por cada mensaje ───────────────────────────────────────
def vibra(pulsos):
    largo, pausa = 0.2, 0.1
    n = int((largo * pulsos + pausa * (pulsos - 1)) * SR)
    t = np.arange(n) / SR
    motor = np.sign(np.sin(2 * np.pi * 168 * t)) * 0.6 + np.sin(2 * np.pi * 336 * t) * 0.3
    aspero = 0.75 + 0.25 * np.sin(2 * np.pi * 31 * t)
    traqueteo = filtro(rng.standard_normal(n), "band", [1800, 3800]) * 0.25
    puerta = np.zeros(n)
    for p in range(pulsos):
        a = int(p * (largo + pausa) * SR)
        puerta[a:a + int(largo * SR)] = env(int(largo * SR), 0.008, 0.03)
    return filtro((motor + traqueteo) * aspero, "low", 2400) * puerta


caos = G["caos"]
for i, m in enumerate(caos):
    siguiente = caos[i + 1]["f"] if i + 1 < len(caos) else 999
    pulsos = 2 if siguiente - m["f"] > 14 else 1
    poner(vibra(pulsos), s(m["f"]), 0.32 + 0.1 * i / len(caos), pan=rng.uniform(-0.15, 0.15))

# ── Clic de la pantalla al apagarse ──────────────────────────────────────────────
clic = filtro(rng.standard_normal(int(0.012 * SR)), "high", 1500) * env(int(0.012 * SR), 0.0005, 0.008)
clic[: int(0.004 * SR)] += np.sin(2 * np.pi * 2300 * np.arange(int(0.004 * SR)) / SR) * 0.6
poner(clic, s(G["sonido"]["apagar"]), 0.5)

# ── Calma: colchón tibio y el aviso suave de Ventra ─────────────────────────────
def colchon(notas, desde, hasta, vol, brillo=900):
    n = s(hasta) - s(desde)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t * (1 + 0.0015 * k)) + 0.5 * np.sin(2 * np.pi * f * t * (1 - 0.002 * k)) for k, f in enumerate(notas))
    x = filtro(x, "low", brillo)
    poner(x / len(notas) * env(n, 1.4, 1.0), s(desde), vol)


colchon([174.6, 220, 261.6, 329.6, 392], E["calma"][0] + 10, E["manana"][0] + 20, 0.13)
for m in G["calma"]:
    poner(campana(783.99, 1.0), s(m["f"]), 0.2, pan=-0.1)
    poner(campana(1174.66, 1.2), s(m["f"]) + int(0.11 * SR), 0.16, pan=0.1)

# ── Mañana: pájaros sintéticos, despertador amable, la agenda que aparece ───────
def pajaro():
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    f0 = rng.uniform(3600, 4600)
    fase = 2 * np.pi * np.cumsum(f0 + 1500 * (t / t[-1]) ** 2) / SR
    return np.sin(fase) * env(n, 0.005, 0.03)


for k in range(14):
    base = s(rng.uniform(E["manana"][0] + 6, E["cierre"][1] - 20))
    for r in range(rng.integers(2, 4)):
        poner(pajaro(), base + int(r * 0.11 * SR), 0.035, pan=rng.uniform(-0.7, 0.7))

aire = filtro(rng.standard_normal(s(E["cierre"][1]) - s(E["manana"][0])), "band", [2500, 9000])
poner(aire * env(len(aire), 1.0, 1.2), s(E["manana"][0]), 0.012)

d = s(G["sonido"]["despertador"])
for r in range(2):
    for j, f in enumerate([1046.5, 1318.5, 1568.0]):
        poner(campana(f, 0.6, 0.2), d + int((r * 0.62 + j * 0.13) * SR), 0.13)

# Barrido al destrabar el celular y un toque por cada turno que aparece
n = int(0.32 * SR)
barrido = filtro(rng.standard_normal(n), "band", [700, 4200]) * np.sin(np.linspace(0, np.pi, n)) ** 2
poner(barrido, s(676), 0.08)
for i in range(len(G["agendaHoy"])):
    poner(campana(2093 + i * 40, 0.12, 0.0), s(676 + 4 + i * 3), 0.025, pan=-0.3 + i * 0.07)

# Colchón luminoso y una figura simple de pulsos desde la mañana hasta el final
colchon([261.6, 329.6, 392, 493.9, 587.3], E["manana"][0], E["cierre"][1], 0.11, brillo=1600)
penta = [523.25, 587.33, 659.25, 783.99, 880.0]
paso = 60 / 100 / 2  # corcheas a 100 bpm
k = 0
tt = E["manana"][0] / FPS + 0.6
while tt < E["cierre"][1] / FPS - 1.2:
    f = penta[[0, 2, 4, 3, 2, 1, 2, 4][k % 8]]
    poner(campana(f, 0.35, 0.1), int(tt * SR), 0.045, pan=0.25 if k % 2 else -0.25)
    tt += paso
    k += 1

# ── Logo ─────────────────────────────────────────────────────────────────────────
lg = s(G["sonido"]["logo"])
for j, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
    poner(campana(f, 1.6, 0.3), lg + int(j * 0.09 * SR), 0.16)

# ── Salida ───────────────────────────────────────────────────────────────────────
fin = env(N, 0.01, 1.2)
mezcla = np.stack([L * fin, R * fin], axis=1)
mezcla /= np.abs(mezcla).max() + 1e-9
mezcla *= 0.8
out_dir = os.path.join(RAIZ, "public", "reel-2347")
os.makedirs(out_dir, exist_ok=True)
crudo = os.path.join(out_dir, "audio-crudo.wav")
wavfile.write(crudo, SR, (mezcla * 32767).astype(np.int16))

ffmpeg = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
salida = os.path.join(out_dir, "audio.wav")
subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", crudo, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), salida], check=True)
os.remove(crudo)
print("listo:", salida)
