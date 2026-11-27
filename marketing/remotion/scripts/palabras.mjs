// Tiempos de cada palabra de una voz, con whisper.cpp local (gratis). Lo usa la fábrica de shorts de Ventri.
//   node scripts/palabras.mjs VOZ.mp3 SALIDA.json
// Escribe la salida cruda de whisper (con tiempos por token), igual que la de los episodios 1 y 2.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { installWhisperCpp, downloadWhisperModel, transcribe } from '@remotion/install-whisper-cpp';

const [entrada, salida] = process.argv.slice(2);
if (!entrada || !salida) {
  console.error('Uso: node scripts/palabras.mjs VOZ.mp3 SALIDA.json');
  process.exit(1);
}
const carpeta = path.resolve('whisper');
const modelo = 'medium';
await installWhisperCpp({ to: carpeta, version: '1.5.5', printOutput: false });
await downloadWhisperModel({ model: modelo, folder: carpeta, printOutput: false });

const wav = path.join(mkdtempSync(path.join(os.tmpdir(), 'palabras-')), 'voz-16k.wav');
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', path.resolve(entrada), '-ar', '16000', '-ac', '1', wav]);
const r = await transcribe({
  inputPath: wav, whisperPath: carpeta, whisperCppVersion: '1.5.5', model: modelo,
  language: 'es', tokenLevelTimestamps: true, printOutput: false,
});
writeFileSync(path.resolve(salida), JSON.stringify(r, null, 1));
console.log('palabras:', salida);
