// ═══════════════════════════════════════════════════
// Escena de fondo generada con IA (Gemini en Vertex AI, con la cuenta de servicio de las funciones).
// Solo el fondo: sin productos, sin texto y sin logos (eso lo pone el diseño, exacto). Si Vertex no
// está activo o falla, devuelve null y la imagen sale con el fondo del diseño.
// ═══════════════════════════════════════════════════
const MODEL = process.env.VENTRA_IMAGE_MODEL || "gemini-2.5-flash-image";
let disabledUntil = 0;

async function accessToken(fetchImpl) {
  if (process.env.K_SERVICE) {
    const r = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    if (!r.ok) return null;
    return (await r.json()).access_token;
  }
  // En una PC: las credenciales de Google de la máquina (gcloud / firebase)
  const { GoogleAuth } = require("google-auth-library");
  return new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getAccessToken();
}

/**
 * prompt: qué escena (la arma la IA con el tono del comercio). aspect: "1:1" o "9:16".
 * Devuelve { buf, mime } o null. opts.fetchImpl / opts.token: para las pruebas.
 */
async function scene(prompt, { aspect = "1:1", project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "ventra-9cba5", logger, fetchImpl = fetch, token } = {}) {
  if (!prompt || Date.now() < disabledUntil) return null;
  try {
    const tok = token || await accessToken(fetchImpl);
    if (!tok) return null;
    const text = `${prompt}\n\nFondo fotográfico para una publicidad. Muy importante: SIN botellas, SIN productos, SIN personas en primer plano, SIN texto, SIN letras, SIN logos ni marcas. Dejá el centro despejado y con poca información (ahí va el producto). Luz cálida, profundidad de campo corta, aspecto profesional.`;
    const r = await fetchImpl(`https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      // Vertex apagado o sin permiso: no se vuelve a probar por una hora
      if (r.status === 403 || r.status === 404) disabledUntil = Date.now() + 60 * 60 * 1000;
      if (logger) logger.warn(`Imágenes: Vertex respondió ${r.status}: ${body}`);
      return null;
    }
    const data = await r.json();
    const part = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.find((p) => p.inlineData);
    return part ? { buf: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType || "image/png" } : null;
  } catch (err) {
    if (logger) logger.warn(`Imágenes: no se pudo generar la escena: ${err && err.message}`);
    return null;
  }
}

module.exports = { scene, MODEL };
