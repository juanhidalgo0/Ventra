// Transcribe un video con whisper.cpp local: node scripts/transcribir.mjs public/video.mp4
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { installWhisperCpp, downloadWhisperModel, transcribe, toCaptions } from '@remotion/install-whisper-cpp';

const entrada = process.argv[2];
const carpeta = path.resolve('whisper');
const modelo = 'medium';

await installWhisperCpp({ to: carpeta, version: '1.5.5' });
await downloadWhisperModel({ model: modelo, folder: carpeta });

mkdirSync('out', { recursive: true });
const wav = path.resolve('out', 'voz-16k.wav');
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', entrada, '-ar', '16000', '-ac', '1', wav]);

const resultado = await transcribe({
  inputPath: wav,
  whisperPath: carpeta,
  whisperCppVersion: '1.5.5',
  model: modelo,
  language: 'es',
  tokenLevelTimestamps: true,
});
const { captions } = toCaptions({ whisperCppOutput: resultado });
const salida = path.join('public', path.basename(entrada, path.extname(entrada)) + '.subs.json');
writeFileSync(salida, JSON.stringify(captions, null, 2));
console.log(captions.map((c) => `${(c.startMs / 1000).toFixed(2)} ${c.text}`).join('\n'));
