const { exec } = require('child_process');

if (process.platform === 'win32') {
  console.log('[Tauri Cleanup] Checking for leftover backend processes...');
  // Terminate any node process running ncc/index.js
  exec('wmic process where "commandline like \'%ncc/index.js%\'" call terminate', (err, stdout, stderr) => {
    if (err) {
      // Ignore errors if no processes are found
      return;
    }
    console.log('[Tauri Cleanup] Stale backend processes cleaned.');
  });
}
