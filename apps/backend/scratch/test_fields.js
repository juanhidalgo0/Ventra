const { DBFFile } = require('dbffile');
async function test() {
  try {
    const dbfPath = 'c:/Users/PC/Desktop/Kiosco/ARTICULO.DBF';
    const dbf = await DBFFile.open(dbfPath);
    console.log('Version:', dbf._version);
    console.log('Memo Path:', dbf._memoPath);
    console.log('Fields:', dbf.fields);
  } catch (err) {
    console.error('Error:', err);
  }
}
test();
