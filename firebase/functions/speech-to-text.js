// Audio → texto (Google Speech-to-Text v2, con la cuenta de servicio de las funciones).
// Copia de functions/speech-to-text.js de GoDelivery. La usa el WhatsApp del dueño (audios).
// Devuelve { text, seconds } o null. Necesita la API Speech-to-Text activa en el proyecto.
async function transcribeAudio(buf, { logger, label = "Speech" } = {}) {
  if (!buf || process.env.FUNCTIONS_EMULATOR === "true") return null;
  try {
    const tok = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
    if (!tok.ok) return null;
    const { access_token: accessToken } = await tok.json();
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    const res = await fetch(`https://speech.googleapis.com/v2/projects/${project}/locations/global/recognizers/_:recognize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { autoDecodingConfig: {}, languageCodes: ["es-AR"], model: "long", features: { enableAutomaticPunctuation: true } },
        content: buf.toString("base64"),
      }),
    });
    if (!res.ok) {
      logger?.warn(`[${label}] Speech-to-Text respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    const text = (data.results || []).map((r) => r.alternatives && r.alternatives[0] && r.alternatives[0].transcript).filter(Boolean).join(" ").trim();
    return { text: text || null, seconds: Number(String((data.metadata && data.metadata.totalBilledDuration) || "0").replace("s", "")) || 0 };
  } catch (err) {
    logger?.warn(`[${label}] No se pudo transcribir el audio:`, err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { transcribeAudio };
