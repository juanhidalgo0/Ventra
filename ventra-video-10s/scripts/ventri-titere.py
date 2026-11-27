# Arma el "títere" de Ventri para los shorts baratos: una pose base sin fondo + parches de boca y de ojos
# que se superponen en la edición (VentriCorto.tsx). Se hace UNA vez por pose; después cada short es gratis.
#
#   python scripts/ventri-titere.py BASE_VERDE.png SALIDA_DIR  nombre:zona:archivo  nombre:zona:archivo ...
#   ej.: python scripts/ventri-titere.py ../marketing/ventri/titere/base-verde.png public/ventri/titere \
#           chica:boca:../marketing/ventri/titere/boca-chica.png  cerrados:ojos:../marketing/ventri/titere/ojos-cerrados.png
#
# - La base y las variantes son imágenes de gpt_image sobre verde croma (#00FF00). La IA nunca devuelve la
#   variante idéntica (corre la figura unos píxeles), así que cada variante se ALINEA a la base con puntos
#   del cuerpo (ORB + transformación de semejanza con RANSAC) y se toma solo la zona que cambió ("boca" u
#   "ojos"), con borde suavizado y el tono del papel igualado al de la base para que no se vea el parche.
# - Escribe base.png (RGBA, recortada) y un PNG por variante del MISMO tamaño (transparente salvo el parche),
#   más titere.json con el tamaño y la caja de cada parche. Imprime una hoja de control (control.jpg).
import json
import os
import sys

import cv2
import numpy as np

# Zonas de la cara en la imagen de 752x1344 (proporcionales: sirven para otro tamaño).
ZONAS = {"boca": (0.27, 0.36, 0.73, 0.49), "ojos": (0.20, 0.24, 0.80, 0.40)}


def croma(img):
    """Máscara del fondo verde: verde brillante y bien saturado. El verde oscuro de la gomita y las
    zapatillas no entra (es oscuro y de otro tono)."""
    b, g, r = [img[..., i].astype(np.int32) for i in range(3)]
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    m = (hsv[..., 0] >= 38) & (hsv[..., 0] <= 82) & (hsv[..., 1] >= 110) & (hsv[..., 2] >= 140) & (g > 1.35 * np.maximum(r, b))
    return m


def sin_fondo(img):
    fondo = croma(img).astype(np.uint8)
    # solo el verde conectado con el borde (por si quedara un reflejo verde adentro)
    n, lab = cv2.connectedComponents(fondo)
    borde = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fondo = np.isin(lab, list(borde)).astype(np.uint8)
    alpha = (1 - fondo) * 255
    alpha = cv2.erode(alpha.astype(np.uint8), np.ones((2, 2), np.uint8))
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
    # sacar el verde que tiñe el borde del contorno
    out = img.copy().astype(np.int32)
    lim = np.maximum(out[..., 0], out[..., 2])
    borde_px = alpha < 250
    out[..., 1] = np.where(borde_px & (out[..., 1] > lim), lim, out[..., 1])
    return np.dstack([out.clip(0, 255).astype(np.uint8), alpha])


def alinear(base, var):
    """Lleva var al marco de base (semejanza: mover, girar un poco, escalar)."""
    orb = cv2.ORB_create(6000)
    gb, gv = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY), cv2.cvtColor(var, cv2.COLOR_BGR2GRAY)
    mb, mv = (~croma(base)).astype(np.uint8) * 255, (~croma(var)).astype(np.uint8) * 255
    kb, db = orb.detectAndCompute(gb, mb)
    kv, dv = orb.detectAndCompute(gv, mv)
    pares = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(dv, db)
    pares = sorted(pares, key=lambda p: p.distance)[:1500]
    src = np.float32([kv[p.queryIdx].pt for p in pares])
    dst = np.float32([kb[p.trainIdx].pt for p in pares])
    M, ok = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    h, w = base.shape[:2]
    alineada = cv2.warpAffine(var, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return alineada, M, int(ok.sum())


def parche(base, alineada, zona, alpha_base):
    h, w = base.shape[:2]
    x0, y0, x1, y1 = ZONAS[zona]
    X0, Y0, X1, Y1 = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
    lab_b = cv2.cvtColor(base, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_v = cv2.cvtColor(alineada, cv2.COLOR_BGR2LAB).astype(np.float32)
    dif = np.linalg.norm(lab_b - lab_v, axis=2)
    m = np.zeros((h, w), np.uint8)
    m[Y0:Y1, X0:X1] = (dif[Y0:Y1, X0:X1] > 28).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # quedarse con lo que cambió de verdad: las manchas más grandes de la zona
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        raise SystemExit(f"no encontré qué cambió en la zona {zona}")
    grande = st[1:, cv2.CC_STAT_AREA].max()
    keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= max(40, grande * 0.08)]
    m = np.isin(lab, keep).astype(np.uint8)
    # la unión de las manchas, rellena, agrandada y suavizada
    k = max(9, int(w * 0.018))
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k * 2 + 1, k * 2 + 1)))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    m = np.zeros_like(m)
    cv2.drawContours(m, [cv2.convexHull(c) for c in cnts], -1, 1, -1)
    suave = cv2.GaussianBlur(m.astype(np.float32), (0, 0), k * 0.45)
    # igualar el tono del papel: anillo alrededor del parche, en las dos imágenes
    anillo = (cv2.dilate(m, np.ones((k, k), np.uint8)) - m).astype(bool) & (alpha_base > 250)
    ajuste = base[anillo].astype(np.float32).mean(0) - alineada[anillo].astype(np.float32).mean(0)
    color = (alineada.astype(np.float32) + ajuste).clip(0, 255).astype(np.uint8)
    a = (suave * (alpha_base / 255.0) * 255).clip(0, 255).astype(np.uint8)
    ys, xs = np.where(a > 0)
    return np.dstack([color, a]), [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], ajuste.round(1).tolist()


def main():
    base_f, salida = sys.argv[1], sys.argv[2]
    os.makedirs(salida, exist_ok=True)
    base = cv2.imread(base_f)
    rgba = sin_fondo(base)
    ys, xs = np.where(rgba[..., 3] > 0)
    m = 12
    cx0, cy0 = max(0, xs.min() - m), max(0, ys.min() - m)
    cx1, cy1 = min(base.shape[1], xs.max() + m), min(base.shape[0], ys.max() + m)
    cv2.imwrite(os.path.join(salida, "base.png"), rgba[cy0:cy1, cx0:cx1])
    info = {"ancho": int(cx1 - cx0), "alto": int(cy1 - cy0), "piezas": {}}
    control = [rgba[cy0:cy1, cx0:cx1]]
    for arg in sys.argv[3:]:
        nombre, zona, archivo = arg.split(":", 2)
        var = cv2.imread(archivo)
        if var.shape != base.shape:
            var = cv2.resize(var, (base.shape[1], base.shape[0]), interpolation=cv2.INTER_CUBIC)
        alineada, M, n = alinear(base, var)
        p, caja, aj = parche(base, alineada, zona, rgba[..., 3])
        p = p[cy0:cy1, cx0:cx1]
        cv2.imwrite(os.path.join(salida, f"{nombre}.png"), p)
        caja = [int(caja[0] - cx0), int(caja[1] - cy0), int(caja[2] - cx0), int(caja[3] - cy0)]
        info["piezas"][nombre] = {"zona": zona, "caja": caja}
        print(f"{nombre}: {n} puntos, corrimiento {M[0, 2]:+.1f},{M[1, 2]:+.1f} px, escala {np.hypot(M[0, 0], M[1, 0]):.4f}, tono {aj}, caja {caja}")
        # control: base con el parche encima
        b = rgba[cy0:cy1, cx0:cx1].astype(np.float32)
        a = p[..., 3:4].astype(np.float32) / 255
        comp = b.copy()
        comp[..., :3] = b[..., :3] * (1 - a) + p[..., :3] * a
        control.append(comp.astype(np.uint8))
    with open(os.path.join(salida, "titere.json"), "w") as f:
        json.dump(info, f, indent=1)
    # hoja de control sobre gris, recortada a la cara
    h = control[0].shape[0]
    caras = []
    for c in control:
        fondo = np.full(c.shape[:2] + (3,), 128, np.float32)
        a = c[..., 3:4].astype(np.float32) / 255
        im = (c[..., :3] * a + fondo * (1 - a)).astype(np.uint8)
        caras.append(im[int(h * 0.15):int(h * 0.52)])
    cv2.imwrite(os.path.join(salida, "control.jpg"), np.hstack(caras), [cv2.IMWRITE_JPEG_QUALITY, 85])
    print("listo:", salida)


if __name__ == "__main__":
    main()
