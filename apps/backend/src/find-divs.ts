import * as fs from 'fs';

function findDivs() {
  const code = fs.readFileSync('c:/Users/PC/Desktop/Kiosco/apps/frontend/src/components/pos/CierreCajaModal.tsx', 'utf8');
  const lines = code.split('\n');
  
  console.log('Line number | Content');
  console.log('---------------------');
  for (let i = 556; i < 790; i++) {
    const line = lines[i];
    if (line.includes('<div') || line.includes('</div>')) {
      console.log(`${i + 1} | ${line.trim()}`);
    }
  }
}

findDivs();
