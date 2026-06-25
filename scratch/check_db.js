const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\PC\\AppData\\Local\\GO! Portal';
if (fs.existsSync(dir)) {
  console.log('Files in GO! Portal AppData:');
  fs.readdirSync(dir).forEach(file => {
    const stats = fs.statSync(path.join(dir, file));
    if (stats.isFile()) {
      console.log(`- ${file} (${stats.size} bytes)`);
    } else {
      console.log(`- [DIR] ${file}`);
    }
  });
} else {
  console.log('Directory not found:', dir);
}
