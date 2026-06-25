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

const dummyBase64Jpeg = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const promptText = `Analiza la boleta.
Extrae los datos en formato JSON con la siguiente estructura:
{
  "rawTableTranscription": "Transcripción en markdown de la tabla de la boleta",
  "supplierName": "Nombre del proveedor",
  "invoiceNumber": "Número de comprobante",
  "date": "Fecha de la factura en formato YYYY-MM-DD",
  "totalFacturaAPagar": "Total general final a pagar",
  "items": [
    {
      "barcode": "Código de barras",
      "sku": "Código interno o número de artículo",
      "name": "Nombre o descripción del producto",
      "packageQuantity": 1,
      "unitsPerPack": 1,
      "total": "Total neto de la línea"
    }
  ]
}`;

const responseSchema = {
  type: 'OBJECT',
  properties: {
    rawTableTranscription: { type: 'STRING', description: 'Transcripción markdown de la tabla de artículos de la boleta.' },
    supplierName: { type: 'STRING' },
    invoiceNumber: { type: 'STRING' },
    date: { type: 'STRING', description: 'Fecha de la boleta en formato YYYY-MM-DD' },
    totalFacturaAPagar: { type: 'STRING', description: 'Total general de la factura impreso al final.' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          barcode: { type: 'STRING' },
          sku: { type: 'STRING' },
          name: { type: 'STRING' },
          packageQuantity: { type: 'NUMBER' },
          unitsPerPack: { type: 'NUMBER' },
          total: { type: 'STRING', description: 'Total neto literal de la línea de la boleta (ej: "6.528,97" o "6528.97")' },
        },
        required: ['name', 'packageQuantity', 'total'],
      },
    },
  },
  required: ['rawTableTranscription', 'items'],
};

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
      console.log(`Testing model: ${model} with schema and image...`);
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          contents: [
            {
              parts: [
                { text: promptText },
                { inlineData: { mimeType: 'image/jpeg', data: dummyBase64Jpeg } }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: responseSchema,
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );
      console.log(`Model ${model} SUCCESS!`);
      console.log(response.data?.candidates?.[0]?.content?.parts?.[0]?.text);
    } catch (err) {
      console.log(`Model ${model} FAILED:`, err.message, err.response?.status, err.response?.data);
    }
  }
}

run();
