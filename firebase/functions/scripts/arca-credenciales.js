// Arma el archivo del secreto ARCA_CREDENTIALS con los certificados de Ventra.
//
//   node scripts/arca-credenciales.js --homo-cert C:/Users/PC/ventra-arca/homologacion.crt
//        --homo-key C:/Users/PC/ventra-arca/homologacion.key
//        [--prod-cert ruta.crt --prod-key ruta.key] --out C:/Users/PC/ventra-arca/secreto.json
//   firebase functions:secrets:set ARCA_CREDENTIALS --data-file C:/Users/PC/ventra-arca/secreto.json
//   (y borrar el archivo después: tiene las claves privadas)
//
// Verifica que cada clave corresponda a su certificado antes de escribir nada. Escribe el
// archivo directo (nunca por la consola): las claves no quedan en el historial de la
// terminal, y en PowerShell 5 redirigir con ">" agregaría una marca BOM que rompe el JSON.
const fs = require("fs");
const forge = require("node-forge");

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const USO = "Uso: node scripts/arca-credenciales.js --homo-cert X --homo-key Y [--prod-cert X --prod-key Y] --out archivo.json";

function load(env, certPath, keyPath) {
  if (!certPath && !keyPath) return null;
  if (!certPath || !keyPath) throw new Error(`${env}: hacen falta el certificado y la clave`);
  const certPem = fs.readFileSync(certPath, "utf8");
  const keyPem = fs.readFileSync(keyPath, "utf8");
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  if (cert.publicKey.n.compareTo(key.n) !== 0) throw new Error(`${env}: la clave no corresponde al certificado`);
  const serial = (cert.subject.attributes.find((a) => a.type === "2.5.4.5") || {}).value || "?";
  const alias = (cert.subject.attributes.find((a) => a.type === "2.5.4.3") || {}).value || "?";
  console.log(`${env}: ${serial}, alias ${alias}, vence ${cert.validity.notAfter.toISOString().slice(0, 10)}`);
  return { cert: certPem, key: keyPem };
}

const destino = arg("--out");
if (!destino) {
  console.error(USO);
  process.exit(1);
}
const out = {};
const homo = load("HOMOLOGACION", arg("--homo-cert"), arg("--homo-key"));
const prod = load("PRODUCCION", arg("--prod-cert"), arg("--prod-key"));
if (homo) out.HOMOLOGACION = homo;
if (prod) out.PRODUCCION = prod;
if (!homo && !prod) {
  console.error(USO);
  process.exit(1);
}
fs.writeFileSync(destino, JSON.stringify(out), { encoding: "utf8" });
console.log(`Listo: ${destino}. Cargalo con "firebase functions:secrets:set ARCA_CREDENTIALS --data-file ${destino}" y después borralo.`);
