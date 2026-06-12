const { DBFFile } = require('dbffile');
const path = require('path');

async function inspect() {
    try {
        const dbfPath = path.join(__dirname, '..', '..', 'ARTICULO.DBF');
        const dbf = await DBFFile.open(dbfPath);
        console.log(`DBF opened. Field count: ${dbf.fields.length}. Record count: ${dbf.recordCount}`);
        console.log('Fields:', dbf.fields.map(f => f.name).join(', '));
        
        const records = await dbf.readRecords(5);
        console.log('First 5 records:', JSON.stringify(records, null, 2));
    } catch (err) {
        console.error('Error:', err);
    }
}

inspect();
