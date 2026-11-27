# Mide la voz de Ventri y la compara con la huella del episodio 1.
#
#   python scripts/ventri-voz-medir.py VOZ.mp3 [--texto "lo que dice"]
#       → tono (mediana y rango), timbre (centroide), volumen (LUFS) y velocidad (sílabas por segundo),
#         y si cada cosa está dentro del margen de marketing/ventri/voz/huella.json.
#   python scripts/ventri-voz-medir.py A.mp3 --contra B.mp3
#       → compara dos archivos entre sí (para comprobar que ventri-voz.py da la p2).
#
# La VOZ tiene que ser la que ya pasó por scripts/ventri-voz.py. Si una toma nueva cae fuera del
# margen, se pide otra toma en ElevenLabs: NO se mueven los números de ventri-voz.py.
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import numpy as np
from scipy.io import wavfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
HUELLA = os.path.join(os.path.dirname(RAIZ), "marketing", "ventri", "voz", "huella.json")
SR = 48000
PISO, TECHO = 100, 600  # los mismos de la p2


def leer(ruta):
    with tempfile.TemporaryDirectory() as tmp:
        sal = os.path.join(tmp, "a.wav")
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", ruta, "-ac", "1", "-ar", str(SR), sal], check=True)
        _, x = wavfile.read(sal)
    return x.astype(np.float64) / 32768


def lufs(ruta):
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", ruta, "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
    return float(m[-1])


def tono(x):
    import parselmouth as pm
    from parselmouth.praat import call
    p = pm.Sound(x, SR).to_pitch(pitch_floor=PISO, pitch_ceiling=TECHO)
    q = lambda f: call(p, "Get quantile", 0, 0, f, "Hertz")
    return q(0.5), q(0.1), q(0.9)


def tramos_con_voz(x, hop=0.01, umbral_db=-35, pausa_min=0.25):
    """Segundos con voz: ventanas de 10 ms por encima de -35 dB del máximo; los huecos de menos de
    0,25 s cuentan como voz (son las consonantes y el aire entre palabras, no pausas)."""
    n = int(hop * SR)
    k = len(x) // n
    e = np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(1)) + 1e-12
    db = 20 * np.log10(e / e.max())
    activo = db > umbral_db
    idx = np.flatnonzero(activo)
    if len(idx) == 0:
        return activo, 0.0
    # rellenar pausas cortas
    hueco = 0
    for i in range(idx[0], idx[-1] + 1):
        if activo[i]:
            if 0 < hueco < pausa_min / hop:
                activo[i - hueco:i] = True
            hueco = 0
        else:
            hueco += 1
    return activo, activo.sum() * hop


def centroide(x, activo, hop=0.01):
    n = int(hop * SR)
    ventana = 2048
    win = np.hanning(ventana)
    freqs = np.fft.rfftfreq(ventana, 1 / SR)
    cs = []
    for i in np.flatnonzero(activo):
        a = i * n
        seg = x[a:a + ventana]
        if len(seg) < ventana:
            break
        mag = np.abs(np.fft.rfft(seg * win))
        if mag.sum() > 0:
            cs.append((freqs * mag).sum() / mag.sum())
    return float(np.mean(cs))


FUERTES = set("aeoáéóíú")


def silabas(texto):
    """Cuenta sílabas en castellano (núcleos vocálicos; i/u sin tilde se pegan a la vocal de al lado)."""
    texto = re.sub(r"\[[^\]]*\]", " ", texto.lower())
    total = 0
    for palabra in re.findall(r"[a-záéíóúüñ]+", texto):
        if palabra == "y":
            total += 1
            continue
        for grupo in re.findall(r"[aeiouáéíóúü]+", palabra):
            total += max(1, sum(1 for c in grupo if c in FUERTES))
    return total


def medir(ruta, texto=None):
    x = leer(ruta)
    med, p10, p90 = tono(x)
    activo, seg_voz = tramos_con_voz(x)
    d = {
        "archivo": os.path.relpath(os.path.abspath(ruta), os.path.dirname(RAIZ)).replace("\\", "/"),
        "duracion_s": round(len(x) / SR, 2),
        "tono_mediana_hz": round(med, 1),
        "tono_p10_hz": round(p10, 1),
        "tono_p90_hz": round(p90, 1),
        "rango_st": round(12 * math.log2(p90 / p10), 2),
        "centroide_hz": round(centroide(x, activo), 0),
        "lufs": round(lufs(ruta), 2),
        "segundos_con_voz": round(seg_voz, 2),
    }
    if texto:
        d["silabas"] = silabas(texto)
        d["silabas_por_seg"] = round(d["silabas"] / seg_voz, 2)
    return d


def st(a, b):
    return 12 * math.log2(a / b)


def comparar(m, ref, margen):
    filas = []
    def fila(nombre, dif, tope, unidad):
        ok = abs(dif) <= tope
        filas.append((nombre, dif, tope, unidad, ok))
    fila("Tono (mediana)", st(m["tono_mediana_hz"], ref["tono_mediana_hz"]), margen["tono_mediana_st"], "semitonos")
    fila("Rango de la melodía", m["rango_st"] - ref["rango_st"], margen["rango_st"], "semitonos")
    fila("Timbre (centroide)", 100 * (m["centroide_hz"] / ref["centroide_hz"] - 1), margen["centroide_pct"], "%")
    fila("Volumen", m["lufs"] - ref["lufs"], margen["lufs"], "LUFS")
    if "silabas_por_seg" in m and "silabas_por_seg" in ref and "silabas_por_seg_pct" in margen:
        fila("Velocidad", 100 * (m["silabas_por_seg"] / ref["silabas_por_seg"] - 1), margen["silabas_por_seg_pct"], "%")
    for nombre, dif, tope, unidad, ok in filas:
        print(f"  {'OK   ' if ok else 'FUERA'} {nombre:22s} {dif:+7.2f} {unidad:9s} (margen ±{tope})")
    return all(f[4] for f in filas)


def main():
    args = sys.argv[1:]
    texto = None
    contra = None
    if "--texto" in args:
        i = args.index("--texto"); texto = args[i + 1]; del args[i:i + 2]
    if "--contra" in args:
        i = args.index("--contra"); contra = args[i + 1]; del args[i:i + 2]
    if len(args) != 1:
        sys.exit(__doc__ or "Uso: python scripts/ventri-voz-medir.py VOZ.mp3 [--texto ...] [--contra OTRA.mp3]")
    m = medir(args[0], texto)
    print(json.dumps(m, ensure_ascii=False, indent=1))
    if contra:
        ref = medir(contra, texto)
        print(f"Contra {contra}:")
        ok = comparar(m, ref, {"tono_mediana_st": 0.3, "rango_st": 1.0, "centroide_pct": 5, "lufs": 0.5})
    else:
        if not os.path.exists(HUELLA):
            sys.exit("Todavía no hay huella (marketing/ventri/voz/huella.json).")
        h = json.load(open(HUELLA, encoding="utf-8"))
        print(f"Contra la huella ({h['voz']['archivo']}):")
        ok = comparar(m, h["voz"], h["margen"])
    print("RESULTADO:", "dentro del margen" if ok else "FUERA del margen: pedir otra toma (no tocar ventri-voz.py)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
