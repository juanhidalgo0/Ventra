# La voz de Ventri ("p2", elegida por el dueño el 2026-11-15). SCRIPT OFICIAL: no cambiar los números.
#
#   python scripts/ventri-voz.py TOMA_DE_ELEVENLABS.mp3 SALIDA.mp3
#
# Toma una toma de Valeria (ElevenLabs, Eleven v4, stability 15 %) y devuelve la voz de Ventri.
# Los números están fijos acá abajo y NO se pueden cambiar por parámetro: así todos los episodios
# suenan igual. Si una toma nueva no da la huella (marketing/ventri/voz/huella.json), se pide otra
# toma en ElevenLabs; no se tocan estos números.
#
# Rehecho el 2026-11-16 con la receta exacta del episodio 1 (sacada de la conversación donde se hizo
# la p2) y comprobado contra p2-psola-dibujito.mp3 (ver marketing/ventri/voz/comprobacion.md).
# Ojo: el piso de tono de la p2 es 100 Hz, no 75 como decía el prompt del ep. 2.
# Para medir una toma contra la huella: python scripts/ventri-voz-medir.py SALIDA.mp3
import os
import subprocess
import sys
import tempfile

# ---------- números fijos de la p2 (no tocar) ----------
PISO_TONO_HZ = 100          # Praat: piso de tono, para medir y para "Change gender"
TECHO_TONO_HZ = 600         # Praat: techo de tono
FORMANTES = 1.13            # formantes ×1,13 (timbre más chico, de dibujito)
SUBIR_SEMITONOS = 3         # tono nuevo = mediana de la toma + 3 semitonos
MELODIA = 1.45              # la melodía sube y baja ×1,45
DURACION = 0.94             # dura ×0,94 (un poquito más rápida)
FILTROS = ",".join([
    "highpass=f=100",                                   # saca el retumbe
    "equalizer=f=3200:t=q:w=1.2:g=2",                   # +2 dB en 3,2 kHz (presencia)
    "highshelf=f=9000:g=2",                             # +2 dB arriba de 9 kHz (aire)
    "deesser=i=0.4",                                    # suaviza las eses
    "acompressor=threshold=-20dB:ratio=3:attack=4:release=90:makeup=2",  # compresor 3:1
    "loudnorm=I=-14:TP=-1:LRA=11",                      # −14 LUFS
])
FRECUENCIA = 48000          # Hz, mono
MP3_KBPS = "192k"
SEMILLA_PRAAT = 20261115    # Praat tira "dados" en las partes sin voz (respiraciones, eses). Con la
                            # semilla fija, la misma toma da SIEMPRE el mismo archivo. La p2 original
                            # se hizo sin semilla: por eso no es idéntica bit a bit, pero sí en tono,
                            # timbre y volumen (ver marketing/ventri/voz/comprobacion.md).
# -------------------------------------------------------

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.path.join(RAIZ, "node_modules", "ffmpeg-static", "ffmpeg.exe")


def main():
    if len(sys.argv) != 3 or sys.argv[1].startswith("-") or sys.argv[2].startswith("-"):
        sys.exit("Uso: python scripts/ventri-voz.py TOMA.mp3 SALIDA.mp3   (o SALIDA.wav)\n"
                 "Los números de la voz son fijos y no se cambian por parámetro.")
    entrada, salida = sys.argv[1], sys.argv[2]
    if not os.path.exists(entrada):
        sys.exit(f"No encuentro {entrada}")

    import parselmouth as pm
    from parselmouth.praat import call, run

    run(f"random_initializeWithSeedUnsafelyButPredictably ({SEMILLA_PRAAT})")

    with tempfile.TemporaryDirectory() as tmp:
        cruda = os.path.join(tmp, "cruda.wav")
        cambiada = os.path.join(tmp, "cambiada.wav")
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", entrada,
                        "-ar", str(FRECUENCIA), "-ac", "1", cruda], check=True)

        s = pm.Sound(cruda)
        mediana = call(s.to_pitch(pitch_floor=PISO_TONO_HZ, pitch_ceiling=TECHO_TONO_HZ),
                       "Get quantile", 0, 0, 0.5, "Hertz")
        nuevo = mediana * 2 ** (SUBIR_SEMITONOS / 12)
        r = call(s, "Change gender", PISO_TONO_HZ, TECHO_TONO_HZ, FORMANTES, nuevo, MELODIA, DURACION)
        pico = float(abs(r.values).max())
        r.save(cambiada, "WAV")  # igual que en la p2 original (WAV de 16 bits, sin escalar)

        args = [FFMPEG, "-y", "-loglevel", "error", "-i", cambiada, "-af", FILTROS, "-ar", str(FRECUENCIA)]
        if salida.lower().endswith(".mp3"):
            args += ["-b:a", MP3_KBPS]
        else:
            args += ["-c:a", "pcm_s16le", "-ac", "1"]
        os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
        subprocess.run(args + [salida], check=True)

    print(f"listo: {salida}  (tono de la toma {mediana:.0f} Hz -> {nuevo:.0f} Hz)")
    if pico > 1.0:
        print(f"AVISO: la toma llega a {pico:.2f} de pico y se recortó un poco al guardar. "
              "Si se escucha raspado, pedí otra toma más baja en ElevenLabs (no cambies los números).")


if __name__ == "__main__":
    main()
