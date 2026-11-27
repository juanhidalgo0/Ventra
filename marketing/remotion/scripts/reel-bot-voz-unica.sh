#!/bin/sh
# Corta la toma única de la voz (public/reel-bot/voz/valeria.mp3, ElevenLabs "Valeria") en 5 tramos
# y los ubica en los momentos del guion (src/reel-bot/guion.json). Los cortes caen en las pausas que
# encontró silencedetect, confirmadas con la transcripción (public/valeria.subs.json).
#   sh scripts/reel-bot-voz-unica.sh
set -e
cd "$(dirname "$0")/.."
FF=node_modules/ffmpeg-static/ffmpeg.exe
IN=public/reel-bot/voz/valeria.mp3
# tramo en la toma (s)                         → arranca en el video
#  0.00-3.40  "Le mando audios… ¡y me contesta!"  0,3 s
#  3.45-9.70  "¿Cuánto vendí hoy?… apagada."      4,6 s
#  9.70-17.57 "¿Me aumentó…? … todas las cajas."  11,2 s
# 17.57-22.08 "¿Quiero una promo?… para subir."   19,4 s
# 22.08-24.35 "Ventra. Hablale a tu negocio."     24,6 s
"$FF" -v error -y -i "$IN" -filter_complex "
[0]atrim=0.00:3.40,asetpts=PTS-STARTPTS,adelay=300|300[a];
[0]atrim=3.45:9.70,asetpts=PTS-STARTPTS,adelay=4600|4600[b];
[0]atrim=9.70:17.57,asetpts=PTS-STARTPTS,adelay=11200|11200[c];
[0]atrim=17.57:22.08,asetpts=PTS-STARTPTS,adelay=19400|19400[d];
[0]atrim=22.08:24.35,asetpts=PTS-STARTPTS,adelay=24600|24600[e];
[a][b][c][d][e]amix=inputs=5:normalize=0,apad=whole_dur=28,atrim=0:28" -ar 48000 -ac 2 public/reel-bot/voz.wav
echo "listo: public/reel-bot/voz.wav"
