# Arma el visor de la cámara del celular (390x844) para pegarlo en la pantalla verde con ventri-pantalla.py:
# la boleta vista por la cámara, el cuadro de enfoque, el disparador que se aprieta, el destello y la foto
# que queda congelada con su miniatura abajo a la izquierda.
#
#   python scripts/ventri-camara.py SALIDA.mp4 --foto grabaciones/boleta.png --dura 1.0 --disparo 0.46
#
#   --disparo  segundo del video en que se saca la foto (tiene que coincidir con el flash del guion,
#              pasado al tiempo de la toma: (G.flash - escena.desde) / 30 * vel de la escena).
import argparse
import math
import os
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

p = argparse.ArgumentParser()
p.add_argument("salida")
p.add_argument("--foto", default="grabaciones/boleta.png")
p.add_argument("--dura", type=float, default=1.0)
p.add_argument("--disparo", type=float, default=0.46)
p.add_argument("--fps", type=int, default=30)
p.add_argument("--forma", type=float, default=0.512, help="ancho/alto de la pantalla verde (si no coincide, ventri-pantalla.py recorta el disparador)")
a = p.parse_args()

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
W = 390
H = int(round(W / a.forma / 2) * 2)
ARRIBA, ABAJO = 64, 176          # barras negras de la cámara
VIS_H = H - ARRIBA - ABAJO
AMARILLO = (255, 204, 0)


def fuente(tam, negrita=False):
    for f in (["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"] if negrita else ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]):
        if os.path.exists(f):
            return ImageFont.truetype(f, tam)
    return ImageFont.load_default()


# la boleta apoyada en el mostrador: papel sobre madera, un poco más grande que el visor para poder moverla
foto = Image.open(os.path.join(RAIZ, a.foto)).convert("RGB")
escena = Image.new("RGB", (W + 80, VIS_H + 80), (150, 96, 52))
d = ImageDraw.Draw(escena)
for y in range(0, escena.height, 14):  # vetas de la madera
    d.line([(0, y), (escena.width, y + 6)], fill=(138, 88, 47), width=3)
bw = int(escena.width * 0.80)
bh = int(foto.height * bw / foto.width)
if bh > escena.height * 0.94:
    bh = int(escena.height * 0.94); bw = int(foto.width * bh / foto.height)
papel = foto.resize((bw, bh), Image.LANCZOS)
sombra = Image.new("L", (bw + 40, bh + 40), 0)
ImageDraw.Draw(sombra).rectangle([20, 20, bw + 20, bh + 20], fill=120)
sombra = sombra.filter(ImageFilter.GaussianBlur(10))
px, py = (escena.width - bw) // 2, (escena.height - bh) // 2
escena.paste((60, 35, 15), (px - 14, py - 6), sombra)
escena.paste(papel, (px, py))
congelada = None


def visor(t):
    """Lo que ve la cámara en el segundo t (pulso de mano, se acomoda y enfoca antes del disparo)."""
    quieto = min(1.0, t / a.disparo)
    amp = 7 * (1 - 0.8 * quieto)
    dx = 40 + amp * math.sin(t * 9.0) + 2 * math.sin(t * 23)
    dy = 40 + amp * math.cos(t * 7.3) + 2 * math.cos(t * 19)
    z = 1.06 - 0.06 * quieto
    cw, ch = W / z, VIS_H / z
    cx, cy = dx + W / 2, dy + VIS_H / 2
    img = escena.crop((int(cx - cw / 2), int(cy - ch / 2), int(cx + cw / 2), int(cy + ch / 2))).resize((W, VIS_H), Image.LANCZOS)
    desenfoque = max(0.0, 2.2 * (1 - t / (a.disparo * 0.7)))
    return img.filter(ImageFilter.GaussianBlur(desenfoque)) if desenfoque > 0.05 else img


n = int(round(a.dura * a.fps))
enc = subprocess.Popen([FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(a.fps),
                        "-i", "-", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", a.salida], stdin=subprocess.PIPE)
for i in range(n):
    t = i / a.fps
    c = Image.new("RGB", (W, H), (0, 0, 0))
    despues = t >= a.disparo
    if despues and congelada is None:
        congelada = visor(a.disparo)
    v = congelada if despues else visor(t)
    c.paste(v, (0, ARRIBA))
    d = ImageDraw.Draw(c)
    # guías de la cámara (tercios) y cuadro de enfoque que se cierra sobre la boleta
    for k in (1, 2):
        d.line([(W * k / 3, ARRIBA), (W * k / 3, ARRIBA + VIS_H)], fill=(255, 255, 255), width=1)
        d.line([(0, ARRIBA + VIS_H * k / 3), (W, ARRIBA + VIS_H * k / 3)], fill=(255, 255, 255), width=1)
    if not despues:
        e = min(1.0, t / (a.disparo * 0.6))
        lado = 230 - 90 * e
        cx, cy = W / 2, ARRIBA + VIS_H / 2
        x0, y0, x1, y1 = cx - lado / 2, cy - lado / 2, cx + lado / 2, cy + lado / 2
        L = 22
        for (xa, ya, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
            d.line([(xa, ya), (xa + L * sx, ya)], fill=AMARILLO, width=4)
            d.line([(xa, ya), (xa, ya + L * sy)], fill=AMARILLO, width=4)
    # barra de arriba
    d.text((W / 2, ARRIBA / 2 + 4), "1x", fill=(255, 255, 255), font=fuente(20, True), anchor="mm")
    # barra de abajo: modo, disparador y miniatura
    d.text((W / 2, H - ABAJO + 24), "FOTO", fill=AMARILLO, font=fuente(18, True), anchor="mm")
    cy = H - ABAJO / 2 + 14
    d.ellipse([W / 2 - 40, cy - 40, W / 2 + 40, cy + 40], outline=(255, 255, 255), width=5)
    apretado = a.disparo - 0.06 <= t < a.disparo + 0.1
    r = 26 if apretado else 32
    d.ellipse([W / 2 - r, cy - r, W / 2 + r, cy + r], fill=(205, 205, 205) if apretado else (255, 255, 255))
    if despues:
        mini = congelada.resize((58, int(58 * VIS_H / W)), Image.LANCZOS)
        mh = min(mini.height, 76)
        mini = mini.crop((0, (mini.height - mh) // 2, 58, (mini.height - mh) // 2 + mh))
        c.paste(mini, (34, int(cy - mh / 2)))
        d.rectangle([34, cy - mh / 2, 34 + 58, cy + mh / 2], outline=(255, 255, 255), width=3)
    else:
        d.rounded_rectangle([34, cy - 30, 92, cy + 30], radius=8, fill=(40, 40, 40))
    # destello del disparo
    arr = np.asarray(c).astype(np.float32)
    fl = max(0.0, 1 - abs(t - (a.disparo + 0.03)) / 0.08)
    if fl > 0:
        arr[ARRIBA:ARRIBA + VIS_H] = arr[ARRIBA:ARRIBA + VIS_H] * (1 - fl) + 255 * fl
    enc.stdin.write(arr.clip(0, 255).astype(np.uint8).tobytes())
enc.stdin.close()
enc.wait()
print("listo:", a.salida, f"({n} cuadros, disparo a {a.disparo} s)")
