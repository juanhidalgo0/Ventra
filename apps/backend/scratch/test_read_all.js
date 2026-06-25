const { DBFFile } = require('dbffile');
async function test() {
  try {
    const dbfPath = 'c:/Users/PC/Desktop/Kiosco/ARTICULO.DBF';
    // Let's test opening in loose mode
    console.log('Opening DBF in loose mode...');
    const dbf = await DBFFile.open(dbfPath, { readMode: 'loose' });
    console.log('Record count:', dbf.recordCount);
    const records = await dbf.readRecords();
    console.log('Successfully read records count:', records.length);
  } catch (err) {
    console.error('Error with loose mode:', err);
  }
}
test();
