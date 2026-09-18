const { app, BrowserWindow, utilityProcess, dialog } = require("electron");
const path = require("path");
const { execSync } = require("child_process");
const isDev = require("electron-is-dev");

const fs = require("fs");
const net = require("net");

// Load .env file from app package directory
try {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, "utf-8");
    envConfig.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
    console.log("[Desktop] Loaded env vars from .env");
  }
} catch (err) {
  console.error("[Desktop] Failed to load .env file:", err);
}

let mainWindow;
let backendProcess;
let activeBackendPort = 3001;
let isQuitting = false;

function findFreePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      server.once("close", () => {
        resolve(startPort);
      });
      server.close();
    });
    server.on("error", () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

function killPort3001() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve();
      return;
    }
    // Only kill processes LISTENING on port 3001 to avoid killing Tailscale client connections to remote servers on 3001
    const cmd = 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr LISTENING ^| findstr :3001\') do taskkill /F /PID %a';
    const { exec } = require("child_process");
    exec(cmd, (err) => {
      resolve();
    });
  });
}

async function startBackend() {
  if (!isDev) {
    await killPort3001();

    const activePort = await findFreePort(3001);
    activeBackendPort = activePort;
    console.log(`[Desktop] Starting backend on port: ${activePort}`);

    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "dev.db");
    const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

    const bundledDbPath = path.join(__dirname, "apps", "backend", "prisma", "dev.db");
    const bundledDbWalPath = bundledDbPath + "-wal";
    const bundledDbShmPath = bundledDbPath + "-shm";
    const dbWalPath = dbPath + "-wal";
    const dbShmPath = dbPath + "-shm";

    try {
      let shouldCopy = false;
      if (!fs.existsSync(dbPath)) {
        shouldCopy = true;
      } else {
        const stats = fs.statSync(dbPath);
        if (stats.size < 50000) {
          console.log("[Desktop] Existing database is unseeded/empty. Overwriting...");
          shouldCopy = true;
        }
      }

      if (shouldCopy && fs.existsSync(bundledDbPath)) {
        console.log(`[Desktop] Copying database template to: ${dbPath}`);
        const dbData = fs.readFileSync(bundledDbPath);
        fs.writeFileSync(dbPath, dbData);

        if (fs.existsSync(bundledDbWalPath)) {
          const walData = fs.readFileSync(bundledDbWalPath);
          fs.writeFileSync(dbWalPath, walData);
        }
        if (fs.existsSync(bundledDbShmPath)) {
          const shmData = fs.readFileSync(bundledDbShmPath);
          fs.writeFileSync(dbShmPath, shmData);
        }

        console.log("[Desktop] Database template and journal files copied successfully.");
      }
    } catch (err) {
      console.error("[Desktop Error] Failed to copy database file:", err);
    }

    const backendPath = path.join(__dirname, "apps", "backend", "dist", "ncc", "index.js");
    const unpackedDir = __dirname.replace("app.asar", "app.asar.unpacked");
    const prismaEnginePath = path.join(unpackedDir, "apps", "backend", "dist", "ncc", "client", "query_engine-windows.dll.node");

    backendProcess = utilityProcess.fork(backendPath, [], {
      cwd: userDataPath,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: activePort.toString(),
        DATABASE_URL: dbUrl,
        PRISMA_QUERY_ENGINE_LIBRARY: prismaEnginePath,
      },
      stdio: "pipe"
    });

    // Listen for custom IPC messages from NestJS backend process
    backendProcess.on("message", (msg) => {
      if (msg && msg.type === "SELECT_SAVE_PATH") {
        const { defaultName } = msg;
        const options = {
          title: "Guardar Copia de Seguridad",
          defaultPath: path.join(app.getPath("documents") || app.getPath("downloads") || userDataPath, defaultName),
          filters: [
            { name: "Base de Datos SQLite", extensions: ["db", "sqlite"] }
          ]
        };
        
        dialog.showSaveDialog(mainWindow, options).then((result) => {
          backendProcess.send({
            type: "SELECT_SAVE_PATH_RESPONSE",
            path: result.canceled ? null : result.filePath
          });
        }).catch((err) => {
          console.error("[Desktop] Error showing save dialog:", err);
          backendProcess.send({
            type: "SELECT_SAVE_PATH_RESPONSE",
            path: null
          });
        });
      }
    });

    backendProcess.on("exit", (code) => {
      console.log(`[Desktop] Backend process exited with code ${code}.`);
      if (!isQuitting) {
        console.log("[Desktop] Automatically restarting backend process...");
        setTimeout(() => {
          startBackend();
        }, 1000);
      }
    });

    const logPath = path.join(userDataPath, "backend.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n--- Backend Start: ${new Date().toISOString()} on port ${activePort} ---\n`);

    if (backendProcess.stdout) {
      backendProcess.stdout.on("data", (data) => {
        console.log(`[Backend]: ${data}`);
        logStream.write(`[STDOUT]: ${data}`);
      });
    }

    if (backendProcess.stderr) {
      backendProcess.stderr.on("data", (data) => {
        console.error(`[Backend Error]: ${data}`);
        logStream.write(`[STDERR]: ${data}`);
      });
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "GoDelivery POS",
    backgroundColor: "#f1f5f9",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Hide the default menu bar (File, Edit, etc.)
  mainWindow.setMenu(null);

  if (isDev) {
    mainWindow.webContents.session.clearCache();
    mainWindow.loadURL("http://localhost:5180");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "frontend/index.html"), {
      query: {
        backend_port: activeBackendPort.toString()
      }
    });
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", async () => {
  await startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (backendProcess) {
      backendProcess.kill();
    }
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (backendProcess) {
    backendProcess.kill();
  }
});
