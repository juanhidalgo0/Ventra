"""Audio del reel "Chau faltazos": foley de papel + ritmo a 120 bpm, todo sintetizado.
Lee los tiempos de src/reel-faltazos/guion.json y sale a public/reel-faltazos/audio.wav (-14 LUFS).

    python scripts/reel-faltazos-audio.py
"""
import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
G = json.load(open(os.path.join(RAIZ, "src", "reel-faltazos", "guion.json"), encoding="utf-8"))
SR = 48000
FPS = G["fps"]
PULSO = G["pulso"]  # cuadros por negra (120 bpm)
N = int(G["total"] / FPS * SR)
E = G["escenas"]
rng = np.random.default_rng(45000)
L = np.zeros(N)
R = np.zeros(N)
CADA = 3


def s(fr):
    return int(round(fr / FPS * SR))


def filtro(x, tipo, f, orden=2):
    return sosfilt(butter(orden, f, btype=tipo, fs=SR, output="sos"), x)


def poner(x, en, vol=1.0, pan=0.0):
    a, b = max(0, en), min(N, en + len(x))
    if b <= a:
        return
    x = x[a - en:b - en] * vol
    L[a:b] += x * (1 - max(0, pan))
    R[a:b] += x * (1 + min(0, pan))


def env(n, ataque, caida):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(ataque, 1e-4)) * np.clip((n / SR - t) / max(caida, 1e-4), 0, 1)


def ruido(seg):
    return rng.standard_normal(int(seg * SR))


def dec(seg, k):
    return np.exp(-np.arange(int(seg * SR)) / SR * k)


# ── Foley de papel ───────────────────────────────────────────────────────────
def golpe_papel():
    x = filtro(ruido(0.05), "band", [250, 3200]) * dec(0.05, 70)
    t = np.arange(int(0.08 * SR)) / SR
    cuerpo = np.sin(2 * np.pi * 95 * t) * np.exp(-t * 45)
    out = np.zeros(int(0.08 * SR))
    out[: len(x)] += x * 0.8
    return out + cuerpo * 0.7


def tic_papel():
    return filtro(ruido(0.018), "band", [1400 + rng.uniform(0, 1500), 7000]) * dec(0.018, 220)


def cinta():
    n = int(0.16 * SR)
    puerta = (rng.random(n) > 0.82).astype(float)
    puerta = filtro(puerta, "low", 900)
    return filtro(ruido(0.16), "band", [900, 6500]) * (0.3 + puerta * 3) * env(n, 0.005, 0.05)


def barrido(seg=0.28):
    n = int(seg * SR)
    x = ruido(seg)
    out = np.zeros(n)
    for i, f0 in enumerate(np.linspace(600, 3500, 6)):
        a = i * n // 6
        out[a:] += filtro(x, "band", [f0 * 0.7, f0 * 1.4])[a:] / 6
    return out * np.sin(np.linspace(0, np.pi, n)) ** 1.5


def birome(seg):
    n = int(seg * SR)
    am = np.abs(filtro(rng.standard_normal(n), "low", 40))
    am /= am.max() + 1e-9
    return filtro(ruido(seg), "band", [2200, 7500]) * am * env(n, 0.01, 0.03)


def marcador(seg, pasadas=1):
    n = int(seg * SR)
    t = np.arange(n) / SR
    zig = np.abs(np.sin(np.pi * pasadas * t / seg))  # cada pasada del tachón
    tono = np.sin(2 * np.pi * np.cumsum(1700 + 500 * zig) / SR) * 0.35
    friccion = filtro(ruido(seg), "band", [1500, 5000]) * (0.5 + 0.5 * zig)
    return (tono + friccion) * env(n, 0.01, 0.04)


def tecla():
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    clac = filtro(ruido(0.03), "high", 2200) * np.exp(-t * 260)
    cuerpo = np.sin(2 * np.pi * (190 + rng.uniform(-20, 20)) * t) * np.exp(-t * 90) * 0.6
    return clac + cuerpo


def toque():
    t = np.arange(int(0.06 * SR)) / SR
    return np.sin(2 * np.pi * 520 * t) * np.exp(-t * 70) + filtro(ruido(0.06), "band", [800, 3000]) * np.exp(-t * 160) * 0.5


def sello():
    t = np.arange(int(0.35 * SR)) / SR
    bombo = np.sin(2 * np.pi * np.cumsum(55 + 110 * np.exp(-t * 30)) / SR) * np.exp(-t * 11)
    chasquido = filtro(ruido(0.35), "low", 1800) * np.exp(-t * 55)
    goma = filtro(ruido(0.35), "band", [300, 900]) * np.exp(-t * 25) * 0.6
    return bombo * 1.1 + chasquido * 0.7 + goma


def clic_dymo():
    t = np.arange(int(0.05 * SR)) / SR
    return filtro(ruido(0.05), "high", 3000) * np.exp(-t * 400) + filtro(ruido(0.05), "band", [700, 1900]) * np.exp(-t * 80) * 0.7


# ── Instrumentos ─────────────────────────────────────────────────────────────
def bombo():
    t = np.arange(int(0.22 * SR)) / SR
    return np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-t * 35)) / SR) * np.exp(-t * 14)


def aplauso():
    out = np.zeros(int(0.16 * SR))
    for k in range(3):
        a = int(k * 0.011 * SR)
        b = filtro(ruido(0.02), "band", [900, 3200]) * dec(0.02, 160)
        out[a:a + len(b)] += b
    cola = filtro(ruido(0.16), "band", [900, 3200]) * dec(0.16, 30) * 0.35
    return out + cola


def maraca():
    return filtro(ruido(0.045), "high", 5500) * env(int(0.045 * SR), 0.012, 0.03)


def kalimba(freq, dur=0.8, brillo=0.28):
    t = np.arange(int(dur * SR)) / SR
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t * 5)
    x += brillo * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 30)
    return x * env(len(t), 0.002, 0.04)


def bajo(freq, dur=0.42):
    t = np.arange(int(dur * SR)) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t)
    return filtro(x, "low", 500) * np.exp(-t * 6) * env(len(t), 0.004, 0.05)


NOTA = {"A2": 110, "C3": 130.81, "D3": 146.83, "E3": 164.81, "F2": 87.31, "G2": 98.0, "A3": 220, "E2": 82.41,
        "G4": 392, "A4": 440, "B4": 493.88, "C5": 523.25, "D5": 587.33, "E5": 659.25, "F5": 698.46, "G5": 783.99, "A5": 880}


def pulso(b):
    """Cuadro del pulso número b."""
    return b * PULSO


# Parte triste (agenda con faltazos y el precio): kalimba en La menor, sin batería
triste = ["A4", "C5", "E5", "C5", "G4", "B4", "E5", "B4"]
for b in range(0, E["giro"][0] // PULSO):
    poner(kalimba(NOTA[triste[b % 8]], 1.0, 0.18), s(pulso(b)), 0.14, pan=-0.2 if b % 2 else 0.2)
    if b % 4 == 0:
        poner(bajo(NOTA["A2"] if (b // 4) % 2 == 0 else NOTA["E2"], 1.2), s(pulso(b)), 0.3)
        poner(bombo(), s(pulso(b)), 0.25)

# Giro: redoble de maracas y aplausos que acelera hasta que arranca el ritmo
g0, g1 = E["giro"]
for k, fr in enumerate(np.geomspace(1, g1 - g0, 26)):
    poner(maraca(), s(g1 - fr), 0.12 + 0.12 * k / 26)
poner(aplauso(), s(g1 - PULSO / 2), 0.25)

# Ritmo: Do - La m - Fa - Sol, cuatro pulsos cada acorde
acordes = [("C3", ["C5", "E5", "G5", "E5"]), ("A2", ["A4", "C5", "E5", "C5"]), ("F2", ["F5", "A5", "C5", "A4"]), ("G2", ["G4", "B4", "D5", "G5"])]
b0 = E["aviso"][0] // PULSO
b_fin = E["cierre"][1] // PULSO - 2
for b in range(b0, b_fin):
    fr = pulso(b)
    rel = b - b0
    raiz, arpegio = acordes[(rel // 4) % 4]
    fuerte = 1.25 if E["chau"][0] <= fr < E["chau"][1] else 1.0
    suave = 0.7 if fr >= E["cierre"][0] else 1.0
    if rel % 2 == 0:
        poner(bombo(), s(fr), 0.55 * fuerte * suave)
    else:
        poner(aplauso(), s(fr), 0.32 * fuerte * suave)
    poner(maraca(), s(fr + PULSO / 2), 0.07 * suave)
    poner(maraca(), s(fr), 0.04 * suave)
    poner(bajo(NOTA[raiz]), s(fr), 0.32 * suave)
    poner(kalimba(NOTA[arpegio[rel % 4]], 0.7), s(fr + PULSO / 2), 0.1 * suave, pan=0.3 if rel % 2 else -0.3)

# Final: acorde que queda sonando
fin = E["cierre"][1] - 2 * PULSO - 10
for j, nt in enumerate(["C5", "E5", "G5", "C5"]):
    poner(kalimba(NOTA[nt] * (2 if j == 3 else 1), 2.2, 0.3), s(fin) + int(j * 0.06 * SR), 0.16)
poner(bajo(NOTA["C3"], 1.6), s(fin), 0.35)

# ── Foley según el guion ─────────────────────────────────────────────────────
ag = G["agenda"]
poner(barrido(), s(ag["llega"]), 0.25)
poner(golpe_papel(), s(ag["llega"] + 9), 0.6)
for c in ag["cintas"]:
    poner(cinta(), s(c), 0.32)
poner(birome(ag["titulo"]["dur"] / FPS), s(ag["titulo"]["a"]), 0.12)
for r in ag["filas"]:
    poner(birome(10 / FPS), s(r["a"]), 0.12, pan=0.1)
for t in ag["tachones"]:
    poner(marcador(9 / FPS, 3), s(t["a"]), 0.14)
    poner(marcador(6 / FPS, 1), s(t["a"] + 9), 0.08)


def letras_recortadas(lineas, a, cada, vol=0.3):
    i = 0
    for linea in lineas:
        for ch in linea:
            if ch != " ":
                poner(tic_papel(), s(a + i * cada), vol, pan=rng.uniform(-0.4, 0.4))
                poner(golpe_papel(), s(a + i * cada), vol * 0.25)
            i += 1


letras_recortadas(G["plantada"]["lineas"], G["plantada"]["a"], G["plantada"]["cada"])

et = G["etiqueta"]
poner(barrido(0.2), s(et["llega"]), 0.2)
poner(golpe_papel(), s(et["llega"] + 6), 0.5)
for l in et["lineas"]:
    poner(marcador(l["dur"] / FPS, 2), s(l["a"]), 0.07)

poner(barrido(0.35), s(G["giro"]["hoja"]), 0.35)
poner(golpe_papel(), s(G["giro"]["hoja"] + 9), 0.5)
letras_recortadas(G["giro"]["lineas"], G["giro"]["a"], G["giro"]["cada"])

av = G["aviso"]
poner(barrido(), s(av["telefono"]), 0.28)
poner(golpe_papel(), s(av["telefono"] + 9), 0.6)
for c in av["cintas"]:
    poner(cinta(), s(c), 0.3)
an = av["anotacion"]
poner(birome(an["dur"] / FPS), s(an["a"]), 0.09, pan=0.35)
poner(marcador(6 / FPS, 1), s(an["flecha"]), 0.06, pan=0.3)
for c in av["clientas"]:
    poner(golpe_papel(), s(c["a"]), 0.35, pan=0.4)  # cartelito "el celu de…"
    poner(tic_papel(), s(c["a"] + 3), 0.3)  # llega la burbuja
    escribe = c["a"] + 6
    teclas = max(4, c["escribe"] // 2)
    for k in range(teclas):
        poner(tecla(), s(escribe + k * c["escribe"] / teclas), 0.22 if c["escribe"] > 20 else 0.14, pan=-0.2)
    botones = escribe + c["escribe"] + 1
    poner(tic_papel(), s(botones), 0.25)
    poner(tic_papel(), s(botones + 2), 0.25)
    poner(toque(), s(c["toque"]), 0.45)
    poner(sello(), s(c["sello"]), 0.95)
mano = av["mano"]
poner(barrido(0.3), s(mano["entra"]), 0.22)
poner(barrido(0.25), s(mano["sale"]), 0.18)
cero = av["cero"]
poner(marcador(cero["dur"] / FPS, 3), s(cero["a"]), 0.1)
poner(marcador(9 / FPS, 1), s(cero["circulo"]), 0.1)

letras_recortadas(G["chau"]["lineas"], G["chau"]["a"], G["chau"]["cada"], vol=0.4)

ci = G["cierre"]
poner(golpe_papel(), s(ci["logo"]), 0.55)
for e in ci["etiquetas"]:
    for k in range(len(e["txt"])):
        poner(clic_dymo(), s(e["a"] + k * e["cada"]), 0.2, pan=-0.15)
for m in ci["mano"]:
    poner(marcador(m["dur"] / FPS, 2), s(m["a"]), 0.08)
poner(marcador(6 / FPS, 1), s(ci["subrayado"]), 0.08)

# ── Salida ───────────────────────────────────────────────────────────────────
corte = env(N, 0.005, 0.6)
mezcla = np.stack([L * corte, R * corte], axis=1)
mezcla /= np.abs(mezcla).max() + 1e-9
mezcla *= 0.85
out_dir = os.path.join(RAIZ, "public", "reel-faltazos")
os.makedirs(out_dir, exist_ok=True)
crudo = os.path.join(out_dir, "audio-crudo.wav")
wavfile.write(crudo, SR, (mezcla * 32767).astype(np.int16))
ffmpeg = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
salida = os.path.join(out_dir, "audio.wav")
subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", crudo, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), salida], check=True)
os.remove(crudo)
print("listo:", salida)
