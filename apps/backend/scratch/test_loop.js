const { DBFFile } = require('dbffile');
async function test() {
  try {
    const dbf = await DBFFile.open('c:/Users/PC/Desktop/Kiosco/ARTICULO.DBF');
    console.log('Record count:', dbf.recordCount);
    let totalRead = 0;
    const batchSize = 500;
    for (let i = 0; i < dbf.recordCount; i += batchSize) {
      console.log(`Reading batch at offset ${i}...`);
      const records = await dbf.readRecords(batchSize);
      console.log(`Read ${records.length} records in this batch.`);
      totalRead += records.length;
      
      // Try to parse them to see if any field access fails
      for (const record of records) {
        const numArt = record.NUM_ART;
        const desc = record.DESC;
        const existencia = record.EXISTENCIA;
        const paquete = record.PAQUETE;
        const costo = record.COSTO;
        const precioa = record.PRECIOA;
        
        // Trim/parse just like products.service.ts
        if (numArt) numArt.trim();
        if (desc) desc.trim();
      }
    }
    console.log('Total read in loop:', totalRead);
  } catch (err) {
    console.error('Error in loop:', err);
  }
}
test();
