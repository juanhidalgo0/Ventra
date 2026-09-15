const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('--- GENERADOR DE ACTUALIZACIONES TAURI ---');

// 1. Leer versión actual del tauri.conf.json
const tauriConfPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
if (!fs.existsSync(tauriConfPath)) {
  console.error('No se encontró tauri.conf.json en src-tauri/');
  process.exit(1);
}

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
const version = tauriConf.version;

console.log(`Versión actual en tauri.conf.json: v${version}`);
console.log('IMPORTANTE: Si deseas publicar una nueva versión, debes haber actualizado este número de versión ANTES de correr este script.');

// Rutas de archivos de salida de Tauri
const bundleDir = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle', 'nsis');
// El nombre del archivo depende del productName y version. Ejemplo: GoPortal_1.0.0_x64-setup.nsis.zip
// Vamos a buscar dinámicamente el .zip.sig en esa carpeta que contenga la versión actual.

let sigFilePath = '';
let zipUrl = `https://github.com/juanhidalgo0/Ventra/releases/download/v${version}/Ventra_${version}_x64-setup.nsis.zip`;

if (fs.existsSync(bundleDir)) {
  const files = fs.readdirSync(bundleDir);
  const sigFile = files.find(f => f.endsWith('.zip.sig') && f.includes(version));
  
  if (sigFile) {
    sigFilePath = path.join(bundleDir, sigFile);
    console.log(`\nArchivo de firma encontrado: ${sigFile}`);
  } else {
    console.log('\nNO SE ENCONTRÓ ARCHIVO DE FIRMA PARA ESTA VERSIÓN.');
    console.log(`Asegúrate de haber ejecutado "npm run tauri build" con las variables de entorno de firma:
    set TAURI_SIGNING_PRIVATE_KEY_PATH=C:\\Users\\PC\\Desktop\\Kiosco\\updater.key
    set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=tu_contraseña`);
    process.exit(1);
  }
} else {
  console.log('\nEl directorio de bundle no existe. Debes compilar la aplicación primero.');
  process.exit(1);
}

// Leer la firma
const signature = fs.readFileSync(sigFilePath, 'utf8').trim();

// Generar el latest.json
const latestJson = {
  version: version,
  notes: "Actualización de la aplicación",
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      "signature": signature,
      "url": zipUrl
    }
  }
};

const outputPath = path.join(__dirname, '..', 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(latestJson, null, 2));

console.log('\n--- ÉXITO ---');
console.log(`Se ha generado el archivo latest.json en la raíz del proyecto.`);
console.log('\nPASOS FINALES PARA PUBLICAR LA ACTUALIZACIÓN:');
console.log(`1. Ve a https://github.com/juanhidalgo0/Ventra/releases`);
console.log(`2. Crea un nuevo Release llamado "v${version}" (el tag DEBE SER v${version}).`);
console.log(`3. Sube los siguientes archivos a ese release:`);
console.log(`   - src-tauri/target/release/bundle/nsis/Ventra_${version}_x64-setup.exe (Para instalaciones nuevas)`);
console.log(`   - src-tauri/target/release/bundle/nsis/Ventra_${version}_x64-setup.nsis.zip (El paquete de actualización)`);
console.log(`   - src-tauri/target/release/bundle/nsis/Ventra_${version}_x64-setup.nsis.zip.sig`);
console.log(`   - latest.json (Generado en la raíz de tu proyecto)`);
console.log(`4. Publica el release. ¡Las aplicaciones cliente se actualizarán automáticamente!`);
