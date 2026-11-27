# Sigue el papel en blanco que Ventri tiene en la mano, para escribirle la cuenta encima en la edición.
#
#   python scripts/ventri-tira.py TOMA.mp4 x0,y0,x1,y1 SALIDA.json [--hasta SEG] [--margen PX] [--prueba hoja.jpg]
#
# x0,y0,x1,y1 = el rectángulo del papel en el primer cuadro (en píxeles de la toma). Busca puntos con
# textura alrededor del papel (el contorno negro, los dedos) y los sigue cuadro a cuadro (Lucas-Kanade).
# En cada cuadro calcula cuánto se movió, giró y achicó el papel respecto del primero (transformación de
# semejanza, con RANSAC para que no lo engañe un dedo que se mueve) y lo guarda en el JSON:
#   {"ancho": W, "alto": H, "rect": [x0,y0,x1,y1], "fps": 30, "cuadros": [[a, b, tx, ty], ...]}
# con p' = [[a, -b], [b, a]] · p + [tx, ty]. La edición (VentriEp02.tsx) usa eso para mover el texto.
# --prueba dibuja el rectángulo seguido en una hoja de cuadros para revisarlo a ojo.
import json
import sys
import cv2
import numpy as np


def main():
    args = sys.argv[1:]
    opc = {}
    for k in ("--hasta", "--margen", "--prueba"):
        if k in args:
            i = args.index(k); opc[k] = args[i + 1]; del args[i:i + 2]
    toma, rect, salida = args
    x0, y0, x1, y1 = (int(v) for v in rect.split(","))
    margen = int(opc.get("--margen", 30))
    cap = cv2.VideoCapture(toma)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    hasta = float(opc.get("--hasta", 1e9))
    ok, f0 = cap.read()
    H, W = f0.shape[:2]
    g0 = cv2.cvtColor(f0, cv2.COLOR_BGR2GRAY)
    mask = np.zeros_like(g0)
    mask[max(0, y0 - margen):y1 + margen, max(0, x0 - margen):x1 + margen] = 255
    p0 = cv2.goodFeaturesToTrack(g0, 200, 0.01, 6, mask=mask)
    ref = p0.copy()            # dónde estaba cada punto en el primer cuadro
    prev, pts = g0, p0.copy()
    cuadros = [[1.0, 0.0, 0.0, 0.0]]
    frames = [f0]
    n = 1
    while True:
        ok, f = cap.read()
        if not ok or n / fps > hasta:
            break
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        nuevos, st, _ = cv2.calcOpticalFlowPyrLK(prev, g, pts, None, winSize=(21, 21), maxLevel=3)
        st = st.reshape(-1) == 1
        pts, ref = nuevos[st], ref[st]
        M, inl = cv2.estimateAffinePartial2D(ref, pts, method=cv2.RANSAC, ransacReprojThreshold=3)
        if M is None:
            M = np.array([[1, 0, 0], [0, 1, 0]], float)
        a, b = M[0, 0], M[1, 0]
        cuadros.append([round(float(a), 5), round(float(b), 5), round(float(M[0, 2]), 2), round(float(M[1, 2]), 2)])
        if len(pts) < 25:
            print(f"aviso: cuadro {n}, quedan {len(pts)} puntos")
        prev = g
        frames.append(f)
        n += 1
    json.dump({"ancho": W, "alto": H, "rect": [x0, y0, x1, y1], "fps": fps, "cuadros": cuadros}, open(salida, "w"), indent=0)
    print(f"listo: {salida} ({len(cuadros)} cuadros)")
    if "--prueba" in opc:
        hoja = []
        for i in range(0, len(frames), max(1, len(frames) // 12)):
            a, b, tx, ty = cuadros[i]
            R = np.array([[a, -b], [b, a]])
            esq = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], float) @ R.T + [tx, ty]
            im = frames[i].copy()
            cv2.polylines(im, [esq.astype(np.int32)], True, (0, 0, 255), 3)
            hoja.append(cv2.resize(im, (180, int(180 * H / W))))
        cv2.imwrite(opc["--prueba"], np.hstack(hoja[:12]))


if __name__ == "__main__":
    main()
