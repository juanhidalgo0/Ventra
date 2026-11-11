// Audio → texto (Google Speech-to-Text v2, con la cuenta de servicio de las funciones).
// Basada en functions/speech-to-text.js de GoDelivery. La usa el WhatsApp del dueño (audios).
// Devuelve { text, seconds, model } o null. Necesita la API Speech-to-Text activa en el proyecto.
//
// El modelo "long" no acepta es-AR en la región global (Google responde 400 "language not
// supported"): se prueban combinaciones en orden y se recuerda la primera que anduvo.
const ATTEMPTS = [
  { model: "long", languageCodes: ["es-US"] },
  { model: "short", languageCodes: ["es-US"] },
  { model: "latest_long", languageCodes: ["es-AR"] },
  { model: "latest_short", languageCodes: ["es-AR"] },
];
let working = null;

/** Si el 400 es por el idioma o el modelo (vale la pena probar otra combinación) */
const unsupported = (status, body) => status === 400 && /not supported|language|model/i.test(body);

/** opts.fetchImpl, opts.token y opts.project: solo para las pruebas */
async function transcribeAudio(buf, { logger, label = "Speech", fetchImpl, token: tokenIn, project: projectIn } = {}) {
  if (!buf || (process.env.FUNCTIONS_EMULATOR === "true" && !fetchImpl)) return null;
  const get = fetchImpl || fetch;
  try {
    let accessToken = tokenIn;
    if (!accessToken) {
      const tok = await get("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
      if (!tok.ok) return null;
      accessToken = (await tok.json()).access_token;
    }
    const project = projectIn || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    const order = working ? [working, ...ATTEMPTS.filter((a) => a !== working)] : ATTEMPTS;
    for (const attempt of order) {
      const res = await get(`https://speech.googleapis.com/v2/projects/${project}/locations/global/recognizers/_:recognize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { autoDecodingConfig: {}, ...attempt, features: { enableAutomaticPunctuation: true } },
          content: buf.toString("base64"),
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        if (unsupported(res.status, body)) {
          if (working === attempt) working = null;
          logger?.info?.(`[${label}] Speech-to-Text no acepta ${attempt.model}/${attempt.languageCodes[0]}, pruebo otra`);
          continue;
        }
        logger?.warn(`[${label}] Speech-to-Text respondió ${res.status}: ${body}`);
        return null;
      }
      working = attempt;
      const data = await res.json();
      const text = (data.results || []).map((r) => r.alternatives && r.alternatives[0] && r.alternatives[0].transcript).filter(Boolean).join(" ").trim();
      return { text: text || null, seconds: Number(String((data.metadata && data.metadata.totalBilledDuration) || "0").replace("s", "")) || 0, model: `${attempt.model}/${attempt.languageCodes[0]}` };
    }
    logger?.warn(`[${label}] Speech-to-Text: ninguna combinación de modelo e idioma fue aceptada`);
    return null;
  } catch (err) {
    logger?.warn(`[${label}] No se pudo transcribir el audio:`, err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { transcribeAudio, ATTEMPTS };
