import { generateKeyPairSync } from 'crypto';
import * as forge from 'node-forge';

/**
 * Certificado propio del comercio (sin autorizar a nadie en ARCA). Ventra arma la clave privada
 * y el pedido de certificado (CSR) en el servidor del comercio: la clave nunca sale de ahí. El
 * comercio sube el pedido a ARCA, descarga el certificado y lo carga en Ventra, que lo junta
 * con su clave.
 */

/** Alias del certificado en ARCA ("computador fiscal"): el que el comercio ve en sus relaciones */
export const OWN_CERT_ALIAS = 'ventra';

/** ARCA pide texto simple en el pedido: sin acentos ni signos raros */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,&-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);

export function buildCertificateRequest(cuit: string, razonSocial: string): { keyPem: string; csrPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = forge.pki.publicKeyFromPem(publicKey);
  csr.setSubject([
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: plain(razonSocial) || `CUIT ${cuit}` },
    { name: 'commonName', value: OWN_CERT_ALIAS },
    { type: '2.5.4.5', value: `CUIT ${cuit}` },
  ]);
  csr.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  return { keyPem: privateKey, csrPem: forge.pki.certificationRequestToPem(csr) };
}

/**
 * El certificado tal como lo descarga el comercio: texto PEM o el archivo binario (DER, que
 * llega en base64). Devuelve siempre PEM.
 */
export function certificateToPem(input: { certPem?: string; certDerBase64?: string }): string {
  const text = String(input.certPem || '').trim();
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    return forge.pki.certificateToPem(forge.pki.certificateFromPem(text));
  }
  const b64 = String(input.certDerBase64 || text).replace(/\s+/g, '');
  if (!b64) throw new Error('vacío');
  const der = forge.util.decode64(b64);
  return forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(der)));
}

/** ¿Este certificado es el de esta clave privada? (mismo módulo RSA) */
export function certificateMatchesKey(certPem: string, keyPem: string | null | undefined): boolean {
  if (!keyPem) return false;
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const key = forge.pki.privateKeyFromPem(keyPem);
    return (cert.publicKey as forge.pki.rsa.PublicKey).n.compareTo(key.n) === 0;
  } catch {
    return false;
  }
}
