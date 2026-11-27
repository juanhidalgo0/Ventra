#!/bin/sh
# Arma public/reel-bot/voz.wav con las 6 frases (v1..v6.mp3) en los momentos fijos del guion y
# avisa si alguna frase pisa a la siguiente. Después: python scripts/reel-bot-audio.py y render.
#   sh scripts/reel-bot-voz.sh
set -e
cd "$(dirname "$0")/.."
FF=node_modules/ffmpeg-static/ffmpeg.exe
V=public/reel-bot/voz
INICIOS="0.3 2.5 5.0 12.4 20.3 25.6"   # segundos donde arranca cada frase (escenas de guion.json)
i=1; prev_fin=0
for ini in $INICIOS; do
  dur=$("$FF" -hide_banner -i "$V/v$i.mp3" 2>&1 | sed -n 's/.*Duration: \([0-9:.]*\).*/\1/p' | awk -F: '{print $1*3600+$2*60+$3}')
  sig=$(echo "$INICIOS" | awk -v n=$((i+1)) '{print (n<=NF)?$n:30}')
  fin=$(awk -v a="$ini" -v d="$dur" 'BEGIN{print a+d}')
  awk -v f="$fin" -v s="$sig" -v i="$i" -v d="$dur" 'BEGIN{printf "v%s: %.2f s, termina en %.2f %s\n", i, d, f, (f>s-0.1)?"<- PISA LA SIGUIENTE":""}'
  i=$((i+1))
done
"$FF" -v error -y -i $V/v1.mp3 -i $V/v2.mp3 -i $V/v3.mp3 -i $V/v4.mp3 -i $V/v5.mp3 -i $V/v6.mp3 -filter_complex \
  "[0]adelay=300|300[a];[1]adelay=2500|2500[b];[2]adelay=5000|5000[c];[3]adelay=12400|12400[d];[4]adelay=20300|20300[e];[5]adelay=25600|25600[f];[a][b][c][d][e][f]amix=inputs=6:normalize=0,apad=whole_dur=30,atrim=0:30" \
  -ar 48000 -ac 2 public/reel-bot/voz.wav
echo "listo: public/reel-bot/voz.wav"
