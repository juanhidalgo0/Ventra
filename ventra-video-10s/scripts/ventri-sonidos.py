# Sonidos de la serie de Ventri, hechos con código (sin samples con derechos).
# Salen en public/ventri/sfx/*.wav (48 kHz, mono). La mezcla los ubica según el guion.
#   python scripts/ventri-sonidos.py
#
#   impresora.wav  el "trrrrr" de la impresora térmica con el corte del papel: es la FIRMA de
#                  Ventri (entra a escena saliendo impresa) y va en todos los episodios
#   papeles.wav    la pila de boletas que se le cae encima
#   obturador.wav  la foto del celular
#   sorbo.wav      el sorbo de mate
#   listo.wav      la caja que se actualiza (dos notas cortas, cálidas)
#   whoosh.wav     el zoom que entra a la pantalla de la app
import os
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

SR = 48000
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "public", "ventri", "sfx")
os.makedirs(SALIDA, exist_ok=True)
rng = np.random.default_rng(7)


def t_de(seg):
    return np.arange(int(seg * SR)) / SR


def banda(x, lo, hi, orden=4):
    return sosfilt(butter(orden, [lo, hi], btype="band", fs=SR, output="sos"), x)


def bajos(x, fc, orden=4):
    return sosfilt(butter(orden, fc, btype="low", fs=SR, output="sos"), x)


def altos(x, fc, orden=4):
    return sosfilt(butter(orden, fc, btype="high", fs=SR, output="sos"), x)


def fundido(x, ent=0.004, sal=0.02):
    n_e, n_s = int(ent * SR), int(sal * SR)
    x = x.copy()
    if n_e:
        x[:n_e] *= np.linspace(0, 1, n_e)
    if n_s:
        x[-n_s:] *= np.linspace(1, 0, n_s)
    return x


def guardar(nombre, x, pico=0.89):
    x = x / (np.max(np.abs(x)) + 1e-9) * pico
    wavfile.write(os.path.join(SALIDA, nombre), SR, (x * 32767).astype(np.int16))


def impresora(dur=1.15, rng=rng):
    # Motor paso a paso: clics a ~95 por segundo, más un zumbido agudo del cabezal y el roce del papel.
    t = t_de(dur)
    x = np.zeros_like(t)
    paso = 1 / 95
    for k in range(int(dur / paso)):
        i = max(0, int((k * paso + rng.uniform(-0.0006, 0.0006)) * SR))
        n = int(0.006 * SR)
        if i + n < len(x):
            clic = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.0012 * SR))
            x[i:i + n] += clic * rng.uniform(0.7, 1.0)
    x = banda(x, 900, 5200)
    zumbido = 0.18 * np.sign(np.sin(2 * np.pi * 1180 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 95 * t))
    roce = 0.25 * banda(rng.standard_normal(len(t)), 2500, 9000)
    x = x + bajos(zumbido, 3000) + roce
    # arranca y frena el motor
    env = np.clip(t / 0.05, 0, 1) * np.clip((dur - 0.12 - t) / 0.06, 0, 1)
    x *= env
    # el corte del papel: un "rrip" corto que baja
    corte_t = t_de(0.16)
    ruido = rng.standard_normal(len(corte_t))
    rip = banda(ruido, 1500, 7000) * np.exp(-corte_t / 0.05) * (1 + 0.6 * np.sign(np.sin(2 * np.pi * 70 * corte_t)))
    sal = np.concatenate([x[: int((dur - 0.08) * SR)], np.zeros(int(0.03 * SR))])
    sal = np.concatenate([sal, rip * 1.4, np.zeros(int(0.05 * SR))])
    return fundido(sal)


def papeles():
    dur = 0.9
    t = t_de(dur)
    x = np.zeros_like(t)
    # muchos crujidos sueltos que se apilan, más fuerte al principio (cae la pila)
    for _ in range(140):
        c = rng.uniform(0, dur * 0.85)
        i = int(c * SR)
        n = int(rng.uniform(0.004, 0.03) * SR)
        if i + n < len(x):
            g = np.exp(-c / 0.35) * rng.uniform(0.3, 1)
            x[i:i + n] += rng.standard_normal(n) * np.hanning(n) * g
    x = banda(x, 1800, 9000) + 0.3 * bajos(x, 400)
    golpe = np.sin(2 * np.pi * 70 * t) * np.exp(-t / 0.06) * 0.5
    return fundido(x + golpe)


def obturador():
    t = t_de(0.2)
    x = np.zeros_like(t)
    for c, g in [(0.0, 1.0), (0.055, 0.7)]:
        i = int(c * SR)
        n = int(0.03 * SR)
        x[i:i + n] += rng.standard_normal(n) * np.exp(-np.arange(n) / (0.004 * SR)) * g
    x = banda(x, 1200, 8000) + 0.4 * np.sin(2 * np.pi * 180 * t) * np.exp(-t / 0.02)
    return fundido(x)


def sorbo():
    dur = 0.7
    t = t_de(dur)
    # aire por la bombilla: ruido filtrado con burbujeo irregular
    burbujas = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * (14 + 6 * np.sin(2 * np.pi * 2.3 * t)) * t))
    x = banda(rng.standard_normal(len(t)), 500, 3200) * (0.35 + 0.65 * burbujas)
    env = np.clip(t / 0.08, 0, 1) * np.clip((dur - t) / 0.2, 0, 1)
    x = x * env
    # el "ahh" final, chiquito y grave
    return fundido(bajos(x, 2500))


def listo():
    dur = 0.55
    t = t_de(dur)
    x = np.zeros_like(t)
    for c, f in [(0.0, 1318.5), (0.09, 1975.5)]:  # Mi6 y Si6
        i = int(c * SR)
        tt = t[: len(t) - i]
        nota = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt / 0.16)
        x[i:] += nota * 0.6
    return fundido(x)


def whoosh():
    dur = 0.45
    t = t_de(dur)
    ruido = rng.standard_normal(len(t))
    # barrido de un pasabanda que sube
    trozos = []
    paso = int(0.01 * SR)
    for k in range(0, len(t), paso):
        fc = 400 + 5000 * (k / len(t)) ** 1.5
        trozos.append(banda(ruido[k:k + paso + 200], fc * 0.7, min(fc * 1.4, 20000))[:paso])
    x = np.concatenate(trozos)[: len(t)]
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return fundido(x * env)


for nombre, fn in [("impresora.wav", impresora), ("papeles.wav", papeles), ("obturador.wav", obturador),
                   ("sorbo.wav", sorbo), ("listo.wav", listo), ("whoosh.wav", whoosh)]:
    guardar(nombre, fn())
    print("listo:", nombre)


# ── Sonidos sumados en el ep. 2 ("Ventri explica"). Usan su propio azar, así los de arriba quedan
#    exactamente iguales (comprobado con md5).
#   tira.wav   la misma impresora pero cortita: cada dato sale impreso en una tira nueva
#   rompe.wav  el papel que se rompe de un tirón
#   tic.wav    el marcador que toca el almanaque
rng2 = np.random.default_rng(202)


def tira():
    return impresora(0.42, rng2)


def rompe():
    dur = 0.38
    t = t_de(dur)
    x = np.zeros_like(t)
    # fibras que se cortan: crujidos cada vez más seguidos y un "rrrip" final
    for _ in range(220):
        c = dur * 0.8 * rng2.uniform(0, 1) ** 0.6
        i = int(c * SR)
        n = int(rng2.uniform(0.002, 0.012) * SR)
        if i + n < len(x):
            x[i:i + n] += rng2.standard_normal(n) * np.hanning(n) * rng2.uniform(0.4, 1)
    x = banda(x, 1200, 9500)
    env = np.clip(t / 0.02, 0, 1) * np.clip((dur - t) / 0.06, 0, 1)
    return fundido(x * env)


def tic():
    t = t_de(0.09)
    golpe = rng2.standard_normal(len(t)) * np.exp(-t / 0.006)
    x = banda(golpe, 1500, 6000) + 0.5 * np.sin(2 * np.pi * 900 * t) * np.exp(-t / 0.015)
    return fundido(x, sal=0.01)


for nombre, fn in [("tira.wav", tira), ("rompe.wav", rompe), ("tic.wav", tic)]:
    guardar(nombre, fn())
    print("listo:", nombre)
