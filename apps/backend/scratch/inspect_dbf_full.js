const { DBFFile } = require('dbffile');
const path = require('path');

async function inspect() {
    try {
        const dbfPath = 'c:/Users/PC/Desktop/Kiosco/ARTICULO.DBF';
        const dbf = await DBFFile.open(dbfPath);
        const records = await dbf.readRecords(100);
        const withBarcode = records.find(r => r.NUM_ART.trim().length > 5);
        console.log('RECORD WITH LONG NUM_ART:');
        console.log(JSON.stringify(withBarcode, null, 2));
    } catch (err) {
        console.error('Error inspecting DBF:', err);
    }
}

inspect();
