import * as https from 'https';

/**
 * Agente TLS para hablar con ARCA.
 *
 * El servidor de producción (servicios1.afip.gov.ar) negocia con una clave
 * Diffie-Hellman más corta de lo que Node acepta por defecto, y la conexión se cae
 * con "dh key too small" (EPROTO) antes de mandar nada. Bajar el nivel de seguridad
 * de OpenSSL a SECLEVEL=1 permite el handshake; la conexión sigue siendo TLS 1.2
 * cifrada y verificando el certificado del servidor.
 *
 * Se comparte un solo agente para reusar las conexiones: el mostrador factura seguido
 * y el handshake es lo más caro de cada pedido.
 */
export const arcaHttpsAgent = new https.Agent({
  keepAlive: true,
  minVersion: 'TLSv1.2',
  ciphers: 'DEFAULT:@SECLEVEL=1',
});
