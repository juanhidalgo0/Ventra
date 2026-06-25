const fs = require('fs');
const path = require('path');
const axios = require('axios');

const envPath = 'c:/Users/PC/Desktop/Kiosco/.env';
const envContent = fs.readFileSync(envPath, 'utf8');
const geminiApiKeyMatch = envContent.match(/GEMINI_API_KEY="([^"]+)"/);
const apiKey = geminiApiKeyMatch ? geminiApiKeyMatch[1] : null;

if (!apiKey) {
  console.error('API key not found');
  process.exit(1);
}

const imgPath1 = 'C:/Users/PC/.gemini/antigravity/brain/4648805e-5921-402a-9297-ab6f2d1cd9c6/media__1781302742188.jpg';
const base64Image1 = fs.readFileSync(imgPath1).toString('base64');

const promptText = `Analiza la imagen de la boleta y extrae la lista de todos los productos físicos.

Extrae los datos en formato JSON con la siguiente estructura:
{
  "items": [
    {
      "barcode": "Código de barras numérico (EAN/GTIN) de la columna ARTICULO si existe",
      "name": "Nombre o descripción del producto de la columna DESCRIPCION tal cual figura",
      "packageQuantity": "Cantidad de bultos (columna CANTIDAD)",
      "unitsPerPack": "Unidades por pack (columna U.B.)",
      "total": "Total neto de la línea. REGLA CRÍTICA: Conviértelo a número decimal estándar de EE.UU. sin separador de miles. Por ejemplo, si en la boleta dice '6.528,97', debes devolver '6528.97' como string. Si dice '31.171,08', debes devolver '31171.08'. NUNCA dejes puntos como separador de miles ni comas como decimales."
    }
  ]
}

ANCLAJE DE TOTAL: El total a pagar es 304947.88. Usa este total para corroborar lógicamente que la suma de los totales netos de los productos (más IVA del 21% y restando descuentos) se aproxime a este valor.`;

async function run() {
  try {
    const start = Date.now();
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              { text: promptText },
              { inlineData: { mimeType: 'image/jpeg', data: base64Image1 } }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              items: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    barcode: { type: 'STRING' },
                    name: { type: 'STRING' },
                    packageQuantity: { type: 'NUMBER' },
                    unitsPerPack: { type: 'NUMBER' },
                    total: { type: 'STRING' }
                  },
                  required: ['name', 'packageQuantity', 'total']
                }
              }
            },
            required: ['items']
          }
        }
      },
      { timeout: 20000 }
    );

    console.log(`Success in ${(Date.now() - start)/1000}s`);
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(text);
  } catch (err) {
    console.error('Error:', err.message, err.response?.data);
  }
}

run();
