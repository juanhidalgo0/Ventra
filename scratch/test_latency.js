const axios = require('axios');
const fs = require('fs');

const envPath = 'c:/Users/PC/Desktop/Kiosco/.env';
const envContent = fs.readFileSync(envPath, 'utf8');
const geminiApiKeyMatch = envContent.match(/GEMINI_API_KEY="([^"]+)"/);
const apiKey = geminiApiKeyMatch ? geminiApiKeyMatch[1] : null;

if (!apiKey) {
  console.error('API key not found');
  process.exit(1);
}

const models = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
  'gemini-3.5-flash'
];

async function test() {
  for (const model of models) {
    try {
      const start = Date.now();
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: 'Hola, di ok' }] }]
        },
        { timeout: 10000 }
      );
      console.log(`Model ${model} responded in ${(Date.now() - start)/1000}s:`, res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim());
    } catch (err) {
      console.error(`Model ${model} failed:`, err.message, err.response?.status);
    }
  }
}

test();
