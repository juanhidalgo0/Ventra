#!/bin/sh
# Video final con la mano real: la capa de títulos/promo/cierre (Remotion, transparente) encima de
# public/reel-bot/fondo.mp4 (scripts/reel-bot-componer.py) y el audio (scripts/reel-bot-audio.py).
#   sh scripts/reel-bot-final.sh
set -e
cd "$(dirname "$0")/.."
FF=node_modules/ffmpeg-static/ffmpeg.exe
npx remotion render ReelBotManoCapa out/reel-bot-capa.mov --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le --image-format=png --concurrency=3 --log=error
"$FF" -v error -y -i public/reel-bot/fondo.mp4 -i out/reel-bot-capa.mov -i public/reel-bot/audio.wav \
  -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=5[f];[f][1:v]overlay=0:0:shortest=1,format=yuv420p[v]" \
  -map "[v]" -map 2:a -c:v libx264 -crf 17 -preset medium -c:a aac -b:a 192k -t 28 -movflags +faststart out/reel-bot-mano.mp4
echo "listo: out/reel-bot-mano.mp4"
