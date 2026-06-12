const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'apps/frontend/dist');
const destDir = path.join(__dirname, 'apps/desktop/frontend');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Clean target first if it exists
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}

console.log(`[Copy] Copying frontend build from ${srcDir} to ${destDir}...`);
copyRecursiveSync(srcDir, destDir);
console.log('[Copy] Frontend build copied successfully!');
