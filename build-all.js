const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runCmd(cmd, cwd) {
  console.log(`[Build] Running: ${cmd} in ${cwd || 'root'}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

async function main() {
  try {
    const rootDir = __dirname;
    const backendDir = path.join(rootDir, 'apps', 'backend');

    // 1. Run database checkpoint to merge WAL changes into dev.db
    runCmd('npx tsx prisma/checkpoint.ts', backendDir);

    // 2. Build Frontend
    runCmd('npm run build:frontend', rootDir);

    // 3. Build Backend (generates dist/ncc)
    runCmd('npm run build:backend', rootDir);

    // 4. Copy VC++ DLLs from System32 to bin and dist/ncc
    const dlls = [
      'msvcp140.dll',
      'msvcp140_1.dll',
      'msvcp140_2.dll',
      'msvcp140_atomic_wait.dll',
      'msvcp140_codecvt_ids.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
      'vcruntime140_threads.dll'
    ];

    const binDest = path.join(backendDir, 'bin');
    const nccDest = path.join(backendDir, 'dist', 'ncc');

    console.log('[Build] Copying VC++ DLLs to destination folders...');
    fs.mkdirSync(binDest, { recursive: true });
    fs.mkdirSync(nccDest, { recursive: true });

    for (const dll of dlls) {
      const srcPath = path.join('C:\\Windows\\System32', dll);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(binDest, dll));
        fs.copyFileSync(srcPath, path.join(nccDest, dll));
        console.log(` - Copied: ${dll}`);
      } else {
        console.warn(` - Warning: ${dll} not found in System32`);
      }
    }

    // 5. Run Tauri Build
    runCmd('npx tauri build', rootDir);
    console.log('[Build] Build pipeline completed successfully!');
  } catch (err) {
    console.error('[Build] Build pipeline failed:', err);
    process.exit(1);
  }
}

main();
