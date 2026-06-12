const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backendSrcDir = path.join(__dirname, 'apps/backend');
const backendDestDir = path.join(__dirname, 'apps/desktop/apps/backend');

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
if (fs.existsSync(backendDestDir)) {
  console.log(`[Copy] Cleaning existing backend copy...`);
  try {
    fs.rmSync(backendDestDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (err) {
    try {
      execSync(`rmdir /s /q "${backendDestDir}"`, { stdio: 'ignore' });
    } catch (e) {
      console.error(`[Copy Error] Could not clean backend directory: ${e.message}`);
    }
  }
}

// Ensure dest dir exists
if (!fs.existsSync(backendDestDir)) {
  fs.mkdirSync(backendDestDir, { recursive: true });
}

// Copy ncc build output
const nccSrc = path.join(backendSrcDir, 'dist/ncc');
const nccDest = path.join(backendDestDir, 'dist/ncc');
if (fs.existsSync(nccSrc)) {
  console.log(`[Copy] Copying ncc bundled backend...`);
  copyRecursiveSync(nccSrc, nccDest);
} else {
  console.error(`[Copy Error] ncc build not found in ${nccSrc}. Run "npm run build" with ncc first.`);
  process.exit(1);
}

// Copy prisma schema for database copy mechanism
const prismaSrc = path.join(backendSrcDir, 'prisma');
const prismaDest = path.join(backendDestDir, 'prisma');
if (fs.existsSync(prismaSrc)) {
  console.log(`[Copy] Copying prisma schema and dev.db...`);
  copyRecursiveSync(prismaSrc, prismaDest);
}

// Copy package.json
const pkgSrc = path.join(backendSrcDir, 'package.json');
const pkgDest = path.join(backendDestDir, 'package.json');
if (fs.existsSync(pkgSrc)) {
  fs.copyFileSync(pkgSrc, pkgDest);
}

console.log('[Copy] Backend assets copied successfully! Reduced to a few files for instant startup.');
