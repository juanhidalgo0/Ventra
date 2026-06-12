const { app, BrowserWindow, utilityProcess } = require("electron");
const path = require("path");
const { execSync } = require("child_process");
const isDev = require("electron-is-dev");

const fs = require("fs");
const net = require("net");

let mainWindow;
let backendProcess;
let activeBackendPort = 3001;

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

async function startBackend() {
  if (!isDev) {
    try {
      if (process.platform === "win32") {
        execSync('cmd.exe /c "for /f \\"tokens=5\\" %a in (\'netstat -aon ^| findstr :3001\') do taskkill /F /PID %a"', { stdio: "ignore" });
      }
    } catch (e) {
      console.warn("[Desktop] Zombie port cleanup ignored/failed:", e.message);
    }

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
  if (backendProcess) {
    backendProcess.kill();
  }
});
