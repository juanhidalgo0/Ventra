# Fábrica de shorts de Ventri: de una tanda de guiones (JSON) a videos listos para publicar, casi gratis.
#
#   python scripts/ventri-fabrica.py tandas/semana-01.json                 → todos los shorts de la tanda
#   python scripts/ventri-fabrica.py tandas/semana-01.json --solo ticket   → uno solo (por id)
#   python scripts/ventri-fabrica.py tandas/semana-01.json --programar     → además los programa en el panel de IG
#   python scripts/ventri-fabrica.py tandas/prueba.json --voz-de public/ventri/ep02/voz.mp3
#        → usa una voz que ya existe (ya procesada) en vez de pedirla a ElevenLabs (para probar)
#
# Por cada short (carpeta out/ventri/cortos/<tanda>/<id>/ y public/ventri/cortos/<id>/):
#   1. Voz: ElevenLabs (Valeria, la misma de los episodios; clave y voz en .env) → scripts/ventri-voz.py (p2)
#      → scripts/ventri-voz-medir.py contra la huella. Si da FUERA, pide otra toma (hasta 3). Si ya hay una
#      voz aprobada en la carpeta, no la vuelve a pedir (no gasta dos veces).
#   2. Tiempos de cada palabra: whisper.cpp local (marketing/remotion/scripts/palabras.mjs), alineado letra
#      por letra con el texto del guion (whisper se equivoca en palabras; el texto que se muestra es el del guion).
#   3. Guion de la edición (VentriCorto.tsx): frases, subtítulos cortados por sentido, cortes de cámara,
#      tira impresa, cartel, sello, placa final y efectos → boca (ventri-titere-boca.py) → sonido (ventri-mezcla.py).
#   4. Render del video y de la portada, y el texto para Instagram. Con --programar y "cuando", lo carga en
#      el panel (firebase/functions/scripts/ig-borrador.js; con el piloto automático queda programado).
# Al final escribe out/ventri/cortos/<tanda>/resumen.md. Costo: solo los caracteres de ElevenLabs.
import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIOSCO = os.path.dirname(RAIZ)
REMOTION = os.path.join(KIOSCO, "marketing", "remotion")
FPS = 30
VOZ_EN = 14  # la voz arranca cuando Ventri cae en el mostrador (entrada de 16 cuadros)
FONDOS = {"kiosco": "ventri/titere/fondo-kiosco.png"}
NPX = "npx.cmd" if os.name == "nt" else "npx"
PUNT = re.compile(r"[.,:;?!…]$")


def cargar_env():
    ruta = os.path.join(RAIZ, ".env")
    if os.path.exists(ruta):
        for linea in open(ruta, encoding="utf-8"):
            linea = linea.strip()
            if linea and not linea.startswith("#") and "=" in linea:
                k, v = linea.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"'))


def correr(cmd, cwd=RAIZ, ok=(0,)):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode not in ok:
        sys.exit(f"Falló: {' '.join(cmd)}\n{r.stdout[-1500:]}\n{r.stderr[-1500:]}")
    return r


# ── 1. Voz ───────────────────────────────────────────────────────────────────────────────────────────
def api(metodo, ruta, cuerpo=None):
    req = urllib.request.Request("https://api.elevenlabs.io" + ruta, method=metodo,
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                 headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs respondió {e.code} en {ruta}: {e.read()[:400].decode('utf-8', 'replace')}")


def modelo_eleven():
    m = os.environ.get("VENTRI_ELEVEN_MODEL")
    if m:
        return m
    modelos = json.loads(api("GET", "/v1/models"))
    v4 = [x for x in modelos if x.get("can_do_text_to_speech") and "v4" in (x["model_id"] + x.get("name", "")).lower()]
    if not v4:
        sys.exit("No encontré el modelo Eleven v4 en tu cuenta: poné VENTRI_ELEVEN_MODEL en .env. Modelos: "
                 + ", ".join(x["model_id"] for x in modelos))
    return v4[0]["model_id"]


def pedir_voz(texto, destino):
    voz = os.environ.get("VENTRI_VOICE_ID")
    if not os.environ.get("ELEVENLABS_API_KEY") or not voz:
        sys.exit("Falta ELEVENLABS_API_KEY o VENTRI_VOICE_ID en ventra-video-10s/.env (ver .env.ejemplo).")
    ajustes = json.loads(api("GET", f"/v1/voices/{voz}/settings"))
    ajustes["stability"] = float(os.environ.get("VENTRI_STABILITY", "0.15"))  # biblia: stability 15 %, lo demás como viene
    audio = api("POST", f"/v1/text-to-speech/{voz}?output_format=mp3_44100_128",
                {"text": texto, "model_id": modelo_eleven(), "voice_settings": ajustes})
    open(destino, "wb").write(audio)


def voz_aprobada(texto, carpeta, voz_de=None):
    """Devuelve (ruta de la voz procesada, resultado de la medición)."""
    final = os.path.join(carpeta, "voz.mp3")
    marca = os.path.join(carpeta, "voz.ok")
    if os.path.exists(final) and os.path.exists(marca):
        return final, open(marca, encoding="utf-8").read().strip()
    if voz_de:
        shutil.copy(os.path.join(RAIZ, voz_de), final)
        open(marca, "w", encoding="utf-8").write("voz existente (no se midió)")
        return final, "voz existente (no se midió)"
    for intento in range(1, 4):
        cruda = os.path.join(carpeta, f"voz-cruda-{intento}.mp3")
        pedir_voz(texto, cruda)
        correr([sys.executable, "scripts/ventri-voz.py", cruda, final])
        r = correr([sys.executable, "scripts/ventri-voz-medir.py", final, "--texto", texto], ok=(0, 1))
        if r.returncode == 0:
            open(marca, "w", encoding="utf-8").write(f"dentro del margen (toma {intento})")
            return final, f"dentro del margen (toma {intento})"
        print(f"   toma {intento} FUERA de la huella, pido otra")
    open(marca, "w", encoding="utf-8").write("REVISAR: 3 tomas fuera de la huella (quedó la última)")
    return final, "REVISAR: 3 tomas fuera de la huella (quedó la última)"


# ── 2. Tiempos de cada palabra ─────────────────────────────────────────────────────────────────────────
def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if c.isascii() and c.isalnum())


def tiempos(texto_frases, whisper):
    """[[(palabra, inicio_s, fin_s), ...] por frase] alineando las letras del guion con las de whisper."""
    w_chars, w_t = [], []
    for seg in whisper["transcription"]:
        for tok in seg["tokens"]:
            if tok["text"].startswith("[_"):
                continue
            a, b = tok["offsets"]["from"], tok["offsets"]["to"]
            cs = norm(tok["text"])
            for i, c in enumerate(cs):
                w_chars.append(c)
                w_t.append((a + (b - a) * i / max(1, len(cs)), a + (b - a) * (i + 1) / max(1, len(cs))))
    palabras, g_chars, dueño = [], [], []
    for fi, texto in enumerate(texto_frases):
        for w in texto.split():
            palabras.append([fi, w, None, None])
            for c in norm(w):
                g_chars.append(c)
                dueño.append(len(palabras) - 1)
    sm = difflib.SequenceMatcher(None, "".join(g_chars), "".join(w_chars), autojunk=False)
    for bloque in sm.get_matching_blocks():
        for k in range(bloque.size):
            p = palabras[dueño[bloque.a + k]]
            t0, t1 = w_t[bloque.b + k]
            p[2] = t0 if p[2] is None else min(p[2], t0)
            p[3] = t1 if p[3] is None else max(p[3], t1)
    # palabras que whisper no oyó: se reparten entre las vecinas
    for i, p in enumerate(palabras):
        if p[2] is None:
            ant = next((q[3] for q in reversed(palabras[:i]) if q[3] is not None), 0)
            sig = next((q[2] for q in palabras[i + 1:] if q[2] is not None), ant + 400)
            p[2], p[3] = ant, max(ant + 120, (ant + sig) / 2)
    out = [[] for _ in texto_frases]
    for fi, w, a, b in palabras:
        out[fi].append((w, a / 1000, b / 1000))
    return out


# ── 3. Guion de la edición ─────────────────────────────────────────────────────────────────────────────
# palabras que no pueden cerrar un cartel ni un renglón ("Te toca la / parte" queda feo)
DEBILES = set("a al con de del el en la las lo los mi mis para por que se sin su sus te tu tus un una unos unas y o ni me le les más muy hasta desde cuando como si no".split())


def debil(w):
    return norm(w) in DEBILES and not PUNT.search(w)


def grupos(palabras):
    """Carteles cortados por sentido: primero en la puntuación, después de a 3 palabras (hasta 5) sin
    terminar en "la", "el", "que", etc.; si un cartel queda largo, dos renglones con " / "."""
    clausulas, cur = [], []
    for w in palabras:
        cur.append(w)
        if PUNT.search(w):
            clausulas.append(cur)
            cur = []
    if cur:
        clausulas.append(cur)
    out = []
    for cl in clausulas:
        i = 0
        while i < len(cl):
            resto = len(cl) - i
            if resto <= 4:
                out.append(cl[i:])
                break
            n = 3
            while n < 5 and debil(cl[i + n - 1]):
                n += 1
            if len(cl) - (i + n) == 1:  # no dejar una palabra sola
                n += 1
            out.append(cl[i:i + n])
            i += n
    res = []
    for g in out:
        if len(g) >= 2 and len(" ".join(g)) > 17:
            # renglones parejos, y mejor no cortar después de "que", "el", etc.
            k = min(range(1, len(g)), key=lambda k: abs(len(" ".join(g[:k])) - len(" ".join(g[k:]))) + (6 if debil(g[k - 1]) else 0))
            res.append(" ".join(g[:k]) + " / " + " ".join(g[k:]))
        else:
            res.append(" ".join(g))
    return res


def dos_renglones(texto):
    ws = texto.split()
    k = min(range(1, len(ws)), key=lambda k: abs(len(" ".join(ws[:k])) - len(" ".join(ws[k:])))) if len(ws) > 1 else 1
    return [" ".join(ws[:k]), " ".join(ws[k:])] if len(ws) > 1 else [texto]


def armar_guion(c, tiempos_frases, id_):
    fr_g, planos, efectos = [], [], [{"en": 0, "sonido": "impresora", "gan": 0.7}, {"en": VOZ_EN, "sonido": "whoosh", "gan": 0.3}]
    f = lambda s: int(round(VOZ_EN + s * FPS))
    G = {
        "_nota": f"Generado por scripts/ventri-fabrica.py ({c['id']}). No editar a mano: cambiar la tanda y volver a correr.",
        "fps": FPS, "salida": f"ventri/cortos/{id_}/mezcla.wav", "fondo": FONDOS[c.get("fondo", "kiosco")],
        "titere": {"x": 470, "pie": 1690, "alto": 1000}, "entrada": {"desde": [905, 1440], "dura": 16},
        "voz": {"archivo": f"public/ventri/cortos/{id_}/voz.mp3", "frases": fr_g}, "planos": planos, "efectos": efectos,
    }
    ocupado_hasta = 0  # hasta dónde la cámara tiene que quedar abierta (tira o cartel en pantalla)
    zoom_toca = False
    n = len(c["frases"])
    for i, (fr, pal) in enumerate(zip(c["frases"], tiempos_frases)):
        ini = max(0.0, pal[0][1] - 0.12)
        fin = pal[-1][2] + 0.15
        if i + 1 < n:
            fin = min(fin, max(ini + 0.2, tiempos_frases[i + 1][0][1] - 0.12))
        if fr_g:
            ini = max(ini, fr_g[-1]["hasta"])
        en = f(ini)
        palabras = [{"w": w, "en": f(a), "dura": max(2, f(b) - f(a))} for w, a, b in pal]
        g = {"texto": fr["texto"], "en": en, "dura": max(1, f(fin) - en), "desde": round(ini, 3), "hasta": round(fin, 3),
             "palabras": palabras, "resaltar": fr.get("resaltar", [])}
        if fr.get("fija"):
            g["fija"] = {"desde": 0, "renglones": dos_renglones(fr["texto"])}
        elif fr.get("cierre"):
            g["cierre"] = True
        else:
            g["grupos"] = grupos([p["w"] for p in palabras])
        fr_g.append(g)
        fin_fr = en + g["dura"]
        abre = False
        if fr.get("impresa"):
            im = fr["impresa"] if isinstance(fr["impresa"], dict) else {"renglones": fr["impresa"]}
            r = im["renglones"]
            # la tira mide 290 px: el último renglón (el resultado) más grande, sin salirse del papel
            ren = [{"t": t, "tam": min(54 if k == len(r) - 1 else 40, int(250 / (0.62 * max(1, len(t)))))} for k, t in enumerate(r)]
            sale = en
            if im.get("con"):  # sale de la impresora con una palabra (que no se adelante al resultado)
                sale = next((p["en"] for p in palabras if norm(p["w"]).startswith(norm(im["con"]))), en)
            G["impresa"] = {"desde": max(0, sale - 4), "hasta": fin_fr + 18, "renglones": ren}
            efectos.append({"en": max(0, sale - 4), "sonido": "tira", "gan": 0.45})
            ocupado_hasta, abre = fin_fr + 18, True
        if fr.get("cartel"):
            ca = fr["cartel"]
            cuando = en
            if ca.get("con"):  # entra con una palabra
                cuando = next((p["en"] for p in palabras if norm(p["w"]).startswith(norm(ca["con"]))), en)
            G["cartel"] = {"desde": max(0, cuando - 2), "hasta": fin_fr + 10, "arriba": ca.get("arriba", ""), "grande": ca["grande"], "abajo": ca.get("abajo", "")}
            efectos.append({"en": cuando, "sonido": "tic", "gan": 0.6})
            ocupado_hasta, abre = fin_fr + 10, True
        if fr.get("cierre"):
            ci = fr["cierre"]
            G["cierre"] = {"desde": en, "grande": ci["grande"], "abajo": ci.get("abajo", ""), "web": ci.get("web", "ventra.store")}
            planos.append({"en": max(en, ocupado_hasta), "zoom": 1.0, "foco": [540, 1150]})
            continue
        # cámara: abierta en la primera frase, con tira o cartel; si no, alterna cara / abierta
        if i == 0 or abre:
            planos.append({"en": en if i else 0, "zoom": 1.0, "foco": [540, 1150]})
            zoom_toca = True
        else:
            z = 1.28 if zoom_toca else 1.0
            planos.append({"en": max(en, ocupado_hasta), "zoom": z, "foco": [470, 1050] if z > 1 else [540, 1150]})
            zoom_toca = not zoom_toca
    ult = fr_g[-1]
    G["total"] = ult["en"] + ult["dura"] + (36 if c["frases"][-1].get("cierre") else 18)
    if c.get("serie") == "explica":
        G["sello"] = {"desde": 0, "hasta": G["cierre"]["desde"] if "cierre" in G else G["total"]}
    G["planos"] = sorted(planos, key=lambda p: p["en"])
    return G


# ── 4. Render y publicación ────────────────────────────────────────────────────────────────────────────
def render(G, ruta_guion, carpeta_out):
    props = os.path.join(carpeta_out, "props.json")
    json.dump({"g": G}, open(props, "w", encoding="utf-8"), ensure_ascii=False)
    video = os.path.join(carpeta_out, "video.mp4")
    correr([NPX, "remotion", "render", "VentriCorto", video, f"--props={props}", "--log=error"])
    portada = os.path.join(carpeta_out, "portada.jpg")
    correr([NPX, "remotion", "still", "VentriCorto", portada, f"--props={props}", f"--frame={G['entrada']['dura'] + 14}",
            "--image-format=jpeg", "--jpeg-quality=92", "--log=error"])
    return video, portada


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # la consola de Windows no es UTF-8
    ap = argparse.ArgumentParser()
    ap.add_argument("tanda")
    ap.add_argument("--solo")
    ap.add_argument("--programar", action="store_true")
    ap.add_argument("--voz-de")
    a = ap.parse_args()
    cargar_env()
    T = json.load(open(os.path.join(RAIZ, a.tanda) if not os.path.isabs(a.tanda) else a.tanda, encoding="utf-8"))
    nombre = T.get("tanda") or os.path.splitext(os.path.basename(a.tanda))[0]
    resumen = [f"# Tanda {nombre}", "", "| Short | Dura | Voz | Video | Programado |", "|---|---|---|---|---|"]
    for c in T["cortos"]:
        if a.solo and c["id"] != a.solo:
            continue
        id_ = f"{nombre}-{c['id']}"
        pub = os.path.join(RAIZ, "public", "ventri", "cortos", id_)
        out = os.path.join(RAIZ, "out", "ventri", "cortos", nombre, c["id"])
        os.makedirs(pub, exist_ok=True)
        os.makedirs(out, exist_ok=True)
        print(f"▶ {c['id']}")
        texto = " ".join(fr["texto"] for fr in c["frases"])
        voz, medida = voz_aprobada(texto, pub, a.voz_de)
        print(f"   voz: {medida}")
        wj = os.path.join(pub, "palabras.json")
        if not os.path.exists(wj):
            correr(["node", "scripts/palabras.mjs", voz, wj], cwd=REMOTION)
        T_fr = tiempos([fr["texto"] for fr in c["frases"]], json.load(open(wj, encoding="utf-8")))
        G = armar_guion(c, T_fr, id_)
        ruta_guion = os.path.join(out, "guion.json")
        json.dump(G, open(ruta_guion, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        correr([sys.executable, "scripts/ventri-titere-boca.py", ruta_guion])
        correr([sys.executable, "scripts/ventri-mezcla.py", ruta_guion])
        G = json.load(open(ruta_guion, encoding="utf-8"))
        video, portada = render(G, ruta_guion, out)
        if c.get("texto_ig"):
            open(os.path.join(out, "texto-ig.txt"), "w", encoding="utf-8").write(c["texto_ig"].strip() + "\n")
        prog = "no"
        if a.programar and c.get("cuando") and c.get("texto_ig") and not medida.startswith("REVISAR"):
            r = correr(["node", "scripts/ig-borrador.js", "--tipo", "reel", "--archivo", video, "--portada", portada,
                        "--texto", os.path.join(out, "texto-ig.txt"), "--cuando", c["cuando"],
                        "--nota", f"Fábrica de Ventri, tanda {nombre}: {c['id']}"], cwd=os.path.join(KIOSCO, "firebase", "functions"))
            prog = r.stdout.strip().splitlines()[-1][:90]
        dur = G["total"] / FPS
        resumen.append(f"| {c['id']} | {dur:.1f} s | {medida} | {os.path.relpath(video, RAIZ)} | {prog} |")
        print(f"   listo: {os.path.relpath(video, RAIZ)} ({dur:.1f} s)")
    ruta_res = os.path.join(RAIZ, "out", "ventri", "cortos", nombre, "resumen.md")
    os.makedirs(os.path.dirname(ruta_res), exist_ok=True)
    open(ruta_res, "w", encoding="utf-8").write("\n".join(resumen) + "\n")
    print("resumen:", os.path.relpath(ruta_res, RAIZ))


if __name__ == "__main__":
    main()
