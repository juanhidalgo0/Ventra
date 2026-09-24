// Genera el par de claves Ed25519 que firma el estado de suscripción de cada PC.
//   node scripts/gen-license-keys.js
// - license-private.pem: SECRETA. Se carga en Firebase y después se guarda fuera de la PC:
//     firebase functions:secrets:set VENTRA_LICENSE_PRIVATE_KEY < license-private.pem
// - La clave pública se imprime acá y va dentro de la app (no es secreta).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const out = path.join(__dirname, '..', 'license-private.pem');
if (fs.existsSync(out)) {
  console.error('Ya existe license-private.pem: no se pisa (cambiar la clave desvincula todas las PCs).');
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
