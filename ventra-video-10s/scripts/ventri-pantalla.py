# Pone la app REAL dentro de la pantalla verde de una toma animada de Ventri (celular o monitor).
# Cuadro por cuadro: busca el verde de croma, saca sus 4 esquinas (sigue al celular si se mueve),
# deforma el cuadro de la app para que calce, lo pega donde hay verde y le saca el reflejo verde a
# los bordes. El verde de la marca (gomita, zapatillas) no se toca: es otro tono.
#
#   python scripts/ventri-pantalla.py TOMA.mp4 APP.mp4 SALIDA.mp4 --desde 1.9 --hasta 4.9 \
#       --app "0.95-1.9@0.35,1.91-3.0@1"
#
#   --desde/--hasta  qué parte de la toma se usa (segundos)
#   --app            tramos de la app, en orden: inicio-fin@velocidad (se repite el último cuadro si falta)
import argparse
import subprocess
import os
import cv2
import numpy as np

p = argparse.ArgumentParser()
p.add_argument("toma"); p.add_argument("app"); p.add_argument("salida")
p.add_argument("--desde", type=float, default=0); p.add_argument("--hasta", type=float, default=99)
p.add_argument("--app", dest="tramos", required=True)
p.add_argument("--ancho", type=int, default=1080)
p.add_argument("--forma", choices=["quad", "rect"], default="quad",
               help="quad: sigue la perspectiva (celular en la mano); rect: rectángulo derecho (monitor de frente, aunque algo tape una esquina)")
p.add_argument("--recorte", default="", help="x,y,ancho,alto: parte de la app que se muestra (en píxeles del clip de la app)")
p.add_argument("--agrandar", type=float, default=0.0,
               help="agranda las 4 esquinas desde el centro (0.05 = 5 %%): tapa el borde verde que queda en pantallas con esquinas redondeadas")
a = p.parse_args()
RECORTE = [int(v) for v in a.recorte.split(",")] if a.recorte else None

FFMPEG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "node_modules", "ffmpeg-static", "ffmpeg.exe")


def cuadros_app(ruta, tramos, fps):
    """Lista de cuadros de la app ya re-temporizados al fps de la toma."""
    cap = cv2.VideoCapture(ruta)
    afps = cap.get(cv2.CAP_PROP_FPS)
    todos = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        todos.append(f)
    sal = []
    for tr in tramos.split(","):
        rango, vel = tr.split("@")
        i0, i1 = [float(x) for x in rango.split("-")]
        vel = float(vel)
        n = int(round((i1 - i0) / vel * fps))
        for k in range(n):
            t = i0 + k * vel / fps
            sal.append(todos[min(len(todos) - 1, int(round(t * afps)))])
    return sal


def esquinas(mascara):
    cont, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cont:
        return None
    # todos los pedazos juntos: un brazo que cruza la pantalla la parte en dos
    c = np.vstack(cont)
    if cv2.contourArea(cv2.convexHull(c)) < 2000:
        return None
    casco = cv2.convexHull(c)
    per = cv2.arcLength(casco, True)
    for eps in np.linspace(0.01, 0.12, 24):
        ap = cv2.approxPolyDP(casco, eps * per, True)
        if len(ap) == 4:
            pts = ap.reshape(4, 2).astype(np.float32)
            break
    else:
        pts = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float32)
    # ordenar: arriba-izq, arriba-der, abajo-der, abajo-izq
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)


cap = cv2.VideoCapture(a.toma)
fps = cap.get(cv2.CAP_PROP_FPS)
W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
app = cuadros_app(a.app, a.tramos, fps)
alto_sal = int(round(a.ancho * H / W / 2) * 2)
enc = subprocess.Popen([FFMPEG, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(fps),
                        "-i", "-", "-vf", f"scale={a.ancho}:{alto_sal}:flags=lanczos", "-c:v", "libx264", "-crf", "15",
                        "-pix_fmt", "yuv420p", a.salida], stdin=subprocess.PIPE)
i = n = 0
ultimas = None
while True:
    ok, f = cap.read()
    if not ok:
        break
    t = i / fps
    i += 1
    if t < a.desde - 1e-6 or t > a.hasta:
        continue
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    # verde de croma: brillante y saturado (el verde oscuro del mostrador y de la marca queda afuera)
    m = cv2.inRange(hsv, (48, 150, 100), (72, 255, 255))
    todo_verde = m.copy()
    # quedarse con los pedazos grandes de la pantalla (puede estar partida por un brazo) y tirar motas sueltas
    k, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if k > 1:
        areas = st[1:, cv2.CC_STAT_AREA]
        grandes = 1 + np.nonzero(areas >= 0.04 * areas.max())[0]
        m = np.isin(lab, grandes).astype(np.uint8) * 255
    if a.forma == "rect" and m.any():
        x, y, w, h = cv2.boundingRect(m)
        q = np.float32([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])
    else:
        q = esquinas(m)
    if q is None:
        q = ultimas
    elif a.agrandar:
        q = q.mean(0) + (q - q.mean(0)) * (1 + a.agrandar)
    ultimas = q
    if q is not None:
        # todo el verde que cae dentro de la pantalla (también los pedacitos entre piernas o dedos)
        dentro = np.zeros_like(m)
        cv2.fillConvexPoly(dentro, q.astype(np.int32), 255)
        dentro = cv2.dilate(dentro, np.ones((9, 9), np.uint8), 1)
        m = cv2.bitwise_and(todo_verde, dentro)
        af = app[min(n, len(app) - 1)]
        if RECORTE:
            rx, ry, rw, rh = RECORTE
            af = af[ry:ry + rh, rx:rx + rw]
        ah, aw = af.shape[:2]
        qw = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
        qh = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
        # recorte "cover" de la app al formato de la pantalla verde
        if aw / ah > qw / qh:
            nw = ah * qw / qh; x0 = (aw - nw) / 2; src = np.float32([[x0, 0], [x0 + nw, 0], [x0 + nw, ah], [x0, ah]])
        else:
            nh = aw * qh / qw; y0 = 0; src = np.float32([[0, y0], [aw, y0], [aw, y0 + nh], [0, y0 + nh]])
        M = cv2.getPerspectiveTransform(src, q)
        pegado = cv2.warpPerspective(af, M, (W, H), flags=cv2.INTER_CUBIC)
        mm = cv2.dilate(m, np.ones((3, 3), np.uint8), 1)
        alfa = cv2.GaussianBlur(mm, (3, 3), 0).astype(np.float32)[..., None] / 255
        f = (pegado * alfa + f * (1 - alfa)).astype(np.uint8)
        # sacar el reflejo verde del borde de la pantalla
        banda = cv2.dilate(mm, np.ones((7, 7), np.uint8), 1) > 0
        b, g, r = f[..., 0].astype(np.int16), f[..., 1].astype(np.int16), f[..., 2].astype(np.int16)
        tope = np.maximum(r, b)
        verdoso = banda & (g > tope + 20) & (mm == 0)
        f[..., 1] = np.where(verdoso, tope, g).astype(np.uint8)
    enc.stdin.write(f.tobytes())
    n += 1
enc.stdin.close()
enc.wait()
print(f"listo: {a.salida} ({n} cuadros a {fps:g} fps)")
