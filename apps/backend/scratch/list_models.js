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

axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
  .then(res => {
    console.log('Supported models:');
    res.data.models.forEach(m => console.log(`- ${m.name}`));
  })
  .catch(err => {
    console.error('Error listing models:', err.message);
  });
