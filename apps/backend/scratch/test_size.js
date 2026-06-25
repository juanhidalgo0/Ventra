const { DBFFile } = require('dbffile');
const fs = require('fs');
async function test() {
  try {
    const dbfPath = 'c:/Users/PC/Desktop/Kiosco/ARTICULO.DBF';
    const dbf = await DBFFile.open(dbfPath);
    console.log('Record count in header:', dbf.recordCount);
    console.log('_headerLength:', dbf._headerLength);
    console.log('_recordLength:', dbf._recordLength);
    const stats = fs.statSync(dbfPath);
    console.log('File size in bytes:', stats.size);
    const expectedSize = dbf._headerLength + dbf.recordCount * dbf._recordLength + 1; // +1 for EOF marker
    console.log('Expected file size:', expectedSize);
  } catch (err) {
    console.error('Error:', err);
  }
}
test();
