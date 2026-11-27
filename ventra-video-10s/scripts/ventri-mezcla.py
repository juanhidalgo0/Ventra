# Mezcla el sonido de un episodio de Ventri leyendo el MISMO guion que usa el video.
#   python scripts/ventri-mezcla.py [src/ventri/guion-ep01.json]  →  public/ventri/mezcla.wav
#   (o el archivo que diga "salida" en el guion, relativo a public/, p. ej. "ventri/ep02/mezcla.wav")
#
# - Efectos: public/ventri/sfx/<sonido>.wav en el cuadro "en" de cada efecto (python scripts/ventri-sonidos.py).
# - Voz: si "voz.archivo" existe, cada frase con "desde"/"hasta" (segundos dentro del archivo) entra en su
#   cuadro "en". Debajo de la voz los efectos bajan un poco (para que se entienda siempre).
# - Música: opcional, "musica": {"archivo": ..., "gan": 0.12} (con licencia libre, la elige el dueño).
# - Al final, normaliza a -14 LUFS con el ffmpeg de ffmpeg-static.
import json
import os
import subprocess
import sys
import tempfile
import numpy as np
from scipy.io import wavfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
SR = 48000
guion_ruta = os.path.join(RAIZ, sys.argv[1] if len(sys.argv) > 1 else "src/ventri/guion-ep01.json")
G = json.load(open(guion_ruta, encoding="utf-8"))
FPS = G["fps"]
N = int(round(G["total"] / FPS * SR))


def leer(ruta):
    """Cualquier audio → mono float a 48 kHz (pasa por ffmpeg)."""
    with tempfile.TemporaryDirectory() as tmp:
        sal = os.path.join(tmp, "a.wav")
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", ruta, "-ac", "1", "-ar", str(SR), sal], check=True)
        sr, x = wavfile.read(sal)
    return x.astype(np.float32) / 32768


def poner(pista, x, en_seg, gan=1.0):
    i = int(round(en_seg * SR))
    if i >= len(pista):
        return
    x = x[: len(pista) - i]
    pista[i:i + len(x)] += x * gan


voz = np.zeros(N, np.float32)
efectos = np.zeros(N, np.float32)
musica = np.zeros(N, np.float32)

v = G.get("voz", {})
if v.get("archivo"):
    toma = leer(os.path.join(RAIZ, v["archivo"]))
    for fr in v["frases"]:
        if "desde" not in fr:
            continue
        a, b = int(fr["desde"] * SR), int(fr["hasta"] * SR)
        trozo = toma[a:b].copy()
        n = min(len(trozo), int(0.012 * SR))  # sin clics en los cortes
        trozo[:n] *= np.linspace(0, 1, n); trozo[-n:] *= np.linspace(1, 0, n)
        poner(voz, trozo, fr["en"] / FPS)

for ef in G.get("efectos", []):
    x = leer(os.path.join(RAIZ, "public", "ventri", "sfx", ef["sonido"] + ".wav"))
    poner(efectos, x, ef["en"] / FPS, ef.get("gan", 0.6))

m = G.get("musica")
if m and m.get("archivo"):
    x = leer(os.path.join(RAIZ, m["archivo"]))
    poner(musica, x, m.get("en", 0) / FPS, m.get("gan", 0.12))

# los efectos y la música se corren un poco cuando habla Ventri
env = np.abs(voz)
k = int(0.08 * SR)
env = np.convolve(env, np.ones(k) / k, mode="same")
baja = 1 - 0.45 * np.clip(env / (env.max() + 1e-9) * 4, 0, 1)
mezcla = voz + (efectos + musica) * baja
mezcla = np.stack([mezcla, mezcla], 1)
mezcla /= max(1.0, np.abs(mezcla).max() / 0.95)

# cada episodio puede tener su propia mezcla ("salida" en el guion); sin "salida" es la del ep. 1
dest = os.path.join(RAIZ, "public", *(G.get("salida") or "ventri/mezcla.wav").split("/"))
os.makedirs(os.path.dirname(dest), exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    cruda = os.path.join(tmp, "cruda.wav")
    wavfile.write(cruda, SR, (mezcla * 32767).astype(np.int16))
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", cruda, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", str(SR), dest], check=True)
print("listo:", dest, f"({G['total'] / FPS:.1f} s, voz: {'sí' if v.get('archivo') else 'todavía no'})")
