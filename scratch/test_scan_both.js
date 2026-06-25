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
const imgPath2 = 'C:/Users/PC/.gemini/antigravity/brain/4648805e-5921-402a-9297-ab6f2d1cd9c6/media__1781302742196.jpg';

const base64Image1 = fs.readFileSync(imgPath1).toString('base64');
const base64Image2 = fs.readFileSync(imgPath2).toString('base64');

const promptText = `Eres un experto en OCR visual y extracción de datos estructurados de comprobantes de compra.
Tu tarea es analizar las imágenes de la boleta y extraer la lista completa de todos los productos físicos reales comprados.

Primero, transcribe la tabla completa de artículos de la boleta columna por columna en formato markdown. Esto sirve para alinear visualmente los datos. Luego, extrae cada artículo detallado.

Extrae los datos en formato JSON con la siguiente estructura:
{
  "rawTableTranscription": "Transcripción en markdown de la tabla de la boleta (con columnas: ARTICULO/SKU, CANTIDAD, U.B., DESCRIPCION, PRECIO UNITARIO, TOTAL) para asegurar la alineación horizontal de cada fila.",
  "supplierName": "Nombre del proveedor o emisor de la boleta",
  "invoiceNumber": "Número de comprobante completo",
  "date": "Fecha de la factura en formato YYYY-MM-DD",
  "items": [
    {
      "sku": "Código interno o número de artículo del proveedor",
      "barcode": "Código de barras numérico (EAN/GTIN) si aparece al lado del producto",
      "name": "Nombre o descripción del producto de forma clara y completa",
      "packageQuantity": "Cantidad literal de bultos/packs comprados (columna CANTIDAD)",
      "unitsPerPack": "Unidades por bulto/pack (columna U.B.)",
      "total": "Valor neto o subtotal de la línea de este producto de la columna TOTAL o de la columna de valor final de la fila (como STRING, por ejemplo '6.528,97' o '9.153,36')"
    }
  ]
}

REGLAS CRÍTICAS:
1. Extrae todos los productos físicos.
2. Extrae los precios/totales como STRINGS literales conservando exactamente los puntos y comas de la boleta (ej: "6.528,97").
3. ANCLAJE DE TOTAL: El total final a pagar de esta factura/boleta es exactamente: 304947.88. Usa este valor de anclaje para validar que el subtotal y la suma de los productos coincidan.
4. Asegúrate de alinear correctamente cada columna de la misma fila (código, descripción, cantidad y total de la misma línea pertenecen al mismo producto). Asegúrate de que los valores de TOTAL de cada fila correspondan exactamente a ese producto y no a la fila superior o inferior.`;

async function run() {
  try {
    const start = Date.now();
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              { text: promptText },
              { inlineData: { mimeType: 'image/jpeg', data: base64Image1 } },
              { inlineData: { mimeType: 'image/jpeg', data: base64Image2 } }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              rawTableTranscription: { type: 'STRING', description: 'Transcripción markdown de la tabla de artículos de la boleta.' },
              supplierName: { type: 'STRING' },
              invoiceNumber: { type: 'STRING' },
              date: { type: 'STRING' },
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
                    total: { type: 'STRING', description: 'Total neto literal de la boleta (ej: 6.528,97)' }
                  },
                  required: ['name', 'packageQuantity', 'total']
                }
              }
            },
            required: ['rawTableTranscription', 'items']
          }
        }
      },
      { timeout: 30000 }
    );

    console.log(`Success in ${(Date.now() - start)/1000}s`);
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(text);
  } catch (err) {
    console.error('Error:', err.message, err.response?.data);
  }
}

run();
