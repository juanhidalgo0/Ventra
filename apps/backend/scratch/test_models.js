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
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

async function run() {
  for (const model of models) {
    try {
      console.log(`Testing model: ${model}...`);
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          contents: [
            {
              parts: [
                { text: 'Hello, respond with OK.' }
              ]
            }
          ]
        },
        { timeout: 10000 }
      );
      console.log(`Model ${model} SUCCESS:`, response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim());
    } catch (err) {
      console.log(`Model ${model} FAILED:`, err.message, err.response?.status, err.response?.data);
    }
  }
}

run();
