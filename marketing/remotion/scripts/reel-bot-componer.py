"""Pega el chat (out/reel-bot-pantalla.mp4, 600x1298) sobre la pantalla verde del celular en la mano real
(public/reel-bot/mano/mano.mp4, Kling desde Katana) y saca public/reel-bot/fondo.mp4 (1080x1920, 30 fps).

En cada cuadro: máscara del verde → las 4 esquinas de la pantalla (suavizadas en el tiempo) → el chat con
esa perspectiva, mezclado con la máscara (la isla negra y lo que tape la pantalla quedan arriba) y sin el
borde verde. El video de la mano va y vuelve (ida y vuelta) para durar lo que dure el chat.

    python scripts/reel-bot-componer.py
"""
import os
import subprocess
import sys

import cv2
import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")
MANO = os.path.join(RAIZ, "public", "reel-bot", "mano", "mano.mp4")      # mano quieta (Kling)
PULGAR = os.path.join(RAIZ, "public", "reel-bot", "mano", "pulgar.mp4")  # el pulgar aprieta el micrófono (Kling)

# Línea de tiempo: para cada tramo de la salida (cuadros a 30 fps), de qué video y qué cuadros (a 24 fps).
#   ("lineal", video, desde, hasta, src_desde, src_hasta)   recorre src de src_desde a src_hasta
#   ("vaiven", video, desde, hasta, lo, hi, velocidad)       va y viene entre lo y hi (mano quieta)
# Las apretadas del pulgar en pulgar.mp4: 30-95 y 126-205; sin dedo: 0-24, 96-122, 208-225.
# Coinciden con "grabaciones" de src/reel-bot/guion.json: [6,44] [140,172] [199,220] [352,384].
TIEMPO = [
    ("lineal", "pulgar", 0, 6, 24, 30),        # entra el pulgar
    ("lineal", "pulgar", 6, 44, 30, 88),       # graba el primer audio
    ("lineal", "pulgar", 44, 58, 88, 102),     # suelta: se manda
    ("vaiven", "pulgar", 58, 138, 100, 122, 0.5),
    ("lineal", "pulgar", 138, 140, 124, 126),  # corte de escena; entra el pulgar
    ("lineal", "pulgar", 140, 172, 126, 160),  # graba "¿qué me falta?"
    ("lineal", "pulgar", 172, 188, 204, 214),  # suelta
    ("lineal", "pulgar", 188, 199, 214, 204),  # vuelve a apretar
    ("lineal", "pulgar", 199, 220, 204, 190),  # graba "¿quién me debe?"
    ("lineal", "pulgar", 220, 232, 204, 214),  # suelta
    ("vaiven", "pulgar", 232, 330, 208, 224, 0.4),
    ("vaiven", "pulgar", 330, 346, 100, 120, 0.6),  # corte de escena
    ("lineal", "pulgar", 346, 352, 120, 126),  # entra el pulgar
    ("lineal", "pulgar", 352, 384, 126, 170),  # graba "subí 8% las gaseosas"
    ("lineal", "pulgar", 384, 396, 204, 214),  # suelta
    ("vaiven", "pulgar", 396, 585, 208, 224, 0.4),
    ("lineal", "mano", 585, 738, 60, 180),     # corte de escena: la promo, mano quieta
]
PANT = os.path.join(RAIZ, "out", "reel-bot-pantalla.mp4")
SALIDA = os.path.join(RAIZ, "public", "reel-bot", "fondo.mp4")
W, H, FPS = 1080, 1920, 30


def leer(ruta):
    cap = cv2.VideoCapture(ruta)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    cuadros = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        cuadros.append(fr)
    return cuadros, fps


def mascara_verde(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (38, 90, 80), (88, 255, 255))
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


RADIO = 62  # radio de las esquinas de la pantalla, en px del chat (600 de ancho)


def forma_pantalla(pw, ph):
    m = np.zeros((ph, pw), np.uint8)
    cv2.rectangle(m, (RADIO, 0), (pw - RADIO, ph), 255, -1)
    cv2.rectangle(m, (0, RADIO), (pw, ph - RADIO), 255, -1)
    for cx, cy in ((RADIO, RADIO), (pw - RADIO, RADIO), (RADIO, ph - RADIO), (pw - RADIO, ph - RADIO)):
        cv2.circle(m, (cx, cy), RADIO, 255, -1, cv2.LINE_AA)
    return m


def alfa_pantalla(img, forma_en_cuadro):
    """Dónde va el chat y el fondo limpio. El chat ocupa la forma exacta de la pantalla (rectángulo
    redondeado llevado a la perspectiva del cuadro), menos la isla negra y el pulgar. Antes, al pulgar y
    al borde se les saca el reflejo verde."""
    zona = cv2.dilate(forma_en_cuadro, np.ones((31, 31), np.uint8)) > 0
    limpio = img.copy()
    b, g, r = limpio[..., 0], limpio[..., 1], limpio[..., 2]
    g[zona] = np.minimum(g[zona], np.maximum(r[zona], b[zona]))  # sin reflejo verde
    hsv = cv2.cvtColor(limpio, cv2.COLOR_BGR2HSV)
    verde = mascara_verde(img) > 0
    piel = ((hsv[..., 0] < 25) | (hsv[..., 0] > 160)) & (hsv[..., 1] > 35) & (hsv[..., 2] > 60) & ~verde
    piel = cv2.morphologyEx(piel.astype(np.uint8) * 255, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    piel = cv2.morphologyEx(piel, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
    oscuro = (hsv[..., 2] < 60) & ~verde
    a = (forma_en_cuadro > 127) & ~piel & ~oscuro
    return a.astype(np.float32), limpio


def esquinas(m):
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.02 * m.shape[0] * m.shape[1]:
        return None
    pts = c.reshape(-1, 2).astype(np.float64)
    # caja aproximada para saber qué punto es de qué borde
    caja = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float64)
    s, d = caja.sum(1), caja[:, 0] - caja[:, 1]
    caja = np.array([caja[s.argmin()], caja[d.argmax()], caja[s.argmax()], caja[d.argmin()]])  # ar-izq, ar-der, ab-der, ab-izq
    lineas = []
    for k in range(4):
        a, b = caja[k], caja[(k + 1) % 4]
        v = b - a
        largo = np.linalg.norm(v)
        u = v / largo
        nrm = np.array([-u[1], u[0]])
        t = (pts - a) @ u / largo
        dist = np.abs((pts - a) @ nrm)
        # solo el medio del borde (lejos de esquinas redondeadas, pulgar y manchas) y pegado a él
        sel = pts[(t > 0.25) & (t < 0.75) & (dist < 0.06 * largo + 6)]
        if len(sel) < 20:
            return None
        vx, vy, x0, y0 = cv2.fitLine(sel.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        lineas.append((np.array([x0, y0]), np.array([vx, vy])))
    esq = []
    for k in range(4):  # cada esquina es el cruce del borde anterior con el siguiente
        (p1, d1), (p2, d2) = lineas[k - 1], lineas[k]
        A = np.array([d1, -d2]).T
        try:
            s1, _ = np.linalg.solve(A, p2 - p1)
        except np.linalg.LinAlgError:
            return None
        esq.append(p1 + s1 * d1)
    # el borde k va de la esquina k a la k+1: la esquina k es el cruce de los bordes k-1 y k
    return np.array(esq)


def esquinas_suaves(cuadros):
    """Esquinas de la pantalla en cada cuadro. Si el pulgar tapa la esquina de abajo a la derecha, se
    deduce de las otras tres (paralelogramo). Rellena faltantes, suaviza y agranda un poco."""
    q = []
    for f in cuadros:
        q.append(esquinas(mascara_verde(cv2.resize(f, (W, H), interpolation=cv2.INTER_CUBIC))))
    ult = next(x for x in q if x is not None)
    for i in range(len(q)):
        q[i] = ult if q[i] is None else q[i]
        ult = q[i]
    Q = np.array(q)
    k = 5
    Qs = np.array([Q[max(0, i - k // 2): i + k // 2 + 1].mean(0) for i in range(len(Q))])
    centro = Qs.mean(1, keepdims=True)
    return centro + (Qs - centro) * 1.008  # las rectas van por el borde del verde: apenas más grande


def main():
    pant, _ = leer(PANT)
    videos = {}
    for nombre, ruta in (("mano", MANO), ("pulgar", PULGAR)):
        cuadros, _ = leer(ruta)
        # espejado: la mano queda del lado del micrófono de WhatsApp
        cuadros = [cv2.flip(f, 1) for f in cuadros]  # se amplían a 1080x1920 recién al usarlos (memoria)
        videos[nombre] = (cuadros, esquinas_suaves(cuadros))
        print(nombre, len(cuadros), "cuadros")
    if not pant:
        sys.exit("falta la pantalla")

    fuente = []
    for tramo in TIEMPO:
        tipo, video, a, b = tramo[:4]
        for i in range(a, b):
            if tipo == "lineal":
                s0, s1 = tramo[4], tramo[5]
                j = s0 + (s1 - s0) * (i - a) / max(1, b - a)
            else:
                lo, hi, vel = tramo[4], tramo[5], tramo[6]
                per = 2 * (hi - lo)
                k = ((i - a) * vel) % per
                j = lo + (k if k < hi - lo else per - k)
            fuente.append((video, int(round(j))))

    ph, pw = pant[0].shape[:2]
    origen = np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]])
    forma = forma_pantalla(pw, ph)
    proc = subprocess.Popen([FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                             "-c:v", "libx264", "-crf", "15", "-preset", "fast", "-g", "1", "-pix_fmt", "yuv420p", SALIDA], stdin=subprocess.PIPE)
    for i, chat in enumerate(pant):
        video, j = fuente[min(i, len(fuente) - 1)]
        cuadros, Qs = videos[video]
        j = max(0, min(j, len(cuadros) - 1))
        fondo = cv2.resize(cuadros[j], (W, H), interpolation=cv2.INTER_CUBIC)
        M = cv2.getPerspectiveTransform(origen, np.float32(Qs[j]))
        forma_c = cv2.warpPerspective(forma, M, (W, H), flags=cv2.INTER_LINEAR)
        m, fondo = alfa_pantalla(fondo, forma_c)
        a = cv2.GaussianBlur(m, (5, 5), 0)[..., None]
        chat_s = cv2.GaussianBlur(chat, (3, 3), 0.6)  # un poco de la blandura del video
        pegado = cv2.warpPerspective(chat_s, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
        pegado *= 0.96  # brillo de pantalla real, apenas debajo del blanco puro
        out = fondo.astype(np.float32) * (1 - a) + pegado * a
        proc.stdin.write(np.clip(out, 0, 255).astype(np.uint8).tobytes())
        if i % 120 == 0:
            print("cuadro", i)
    proc.stdin.close()
    proc.wait()
    print("listo:", SALIDA)


if __name__ == "__main__":
    main()
