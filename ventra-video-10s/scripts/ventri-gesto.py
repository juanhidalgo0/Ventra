# Clip de Ventri sobre fondo blanco liso (Kling) → WebP animado con transparencia para la app.
#   python scripts/ventri-gesto.py ENTRADA.mp4 SALIDA.webp [--alto 240] [--fps 15]
# Saca el blanco conectado con el borde (el contorno negro lo frena: los ojos y el papel no se tocan),
# suaviza el borde y recorta todos los cuadros con la misma caja, así no "salta" de lugar.
import argparse, os, subprocess
import numpy as np
from scipy import ndimage
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument("entrada"); p.add_argument("salida")
p.add_argument("--alto", type=int, default=240); p.add_argument("--fps", type=int, default=15)
a = p.parse_args()
FF = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "node_modules", "ffmpeg-static", "ffmpeg.exe")

info = subprocess.run([FF, "-i", a.entrada], capture_output=True, text=True).stderr
import re
w, h = map(int, re.search(r", (\d{3,4})x(\d{3,4})", info).groups())
raw = subprocess.run([FF, "-v", "error", "-i", a.entrada, "-vf", f"fps={a.fps}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)

out = []
for f in frames:
    claro = f.min(axis=2) >= 232
    lab, n = ndimage.label(claro)
    borde = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fondo = np.isin(lab, borde[borde > 0])
    # borde suave: cerca del fondo, la transparencia depende de cuán blanco es el píxel
    cerca = ndimage.binary_dilation(fondo, iterations=2) & ~fondo
    alfa = np.full((h, w), 255, np.uint8)
    alfa[fondo] = 0
    lum = f.min(axis=2).astype(np.float32)
    alfa[cerca] = np.clip((255 - lum[cerca]) * 255 / 60, 0, 255).astype(np.uint8)
    # motas sueltas del fondo (compresión): fuera
    solido = alfa > 30
    lab2, n2 = ndimage.label(solido)
    if n2 > 1:
        tam = ndimage.sum(solido, lab2, range(1, n2 + 1))
        chicos = np.isin(lab2, 1 + np.nonzero(tam < 0.002 * solido.sum())[0])
        alfa[chicos] = 0
    out.append(np.dstack([f, alfa]))

stack = np.stack(out)
ys, xs = np.nonzero(stack[..., 3].max(axis=0) > 30)
y0, y1, x0, x1 = max(0, ys.min() - 4), min(h, ys.max() + 5), max(0, xs.min() - 4), min(w, xs.max() + 5)
imgs = [Image.fromarray(fr[y0:y1, x0:x1]) for fr in stack]
k = a.alto / imgs[0].height
imgs = [im.resize((round(im.width * k), a.alto), Image.LANCZOS) for im in imgs]
imgs[0].save(a.salida, save_all=True, append_images=imgs[1:], duration=round(1000 / a.fps), loop=0, quality=82, method=6, lossless=False)
print("listo:", a.salida, f"{len(imgs)} cuadros, {imgs[0].width}x{imgs[0].height}, {os.path.getsize(a.salida)//1024} KB")
