import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as path from 'path';
import * as fs from 'fs';

// Ensure critical env vars have fallbacks even if .env is missing/incomplete
process.env.JWT_SECRET = process.env.JWT_SECRET || 'paulos-pos-jwt-secret-2024-default';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'paulos-pos-refresh-secret-2024-default';
process.env.JWT_EXPIRATION = process.env.JWT_EXPIRATION || '15m';
process.env.JWT_REFRESH_EXPIRATION = process.env.JWT_REFRESH_EXPIRATION || '7d';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  // The body parser limits are better handled in the module or via specific configuration
  // but for now let's ensure the prefix and basic settings are correct.
  
  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin || 
        origin.indexOf('localhost') !== -1 || 
        origin.indexOf('127.0.0.1') !== -1 || 
        origin.indexOf('firebaseapp.com') !== -1 || 
        origin.indexOf('web.app') !== -1
      ) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  // Serve static files from frontend/dist or Electron package layout
  const express = require('express');
  const possiblePaths = [
    path.join(__dirname, '../../frontend/dist'),
    path.join(__dirname, '../frontend/dist'),
    path.join(__dirname, '../../../frontend/dist'),     // Tauri production layout (up 3 levels from ncc to apps, then down)
    path.join(__dirname, '../../../../frontend/dist'),  // Alternative layout
    path.join(__dirname, '../../../../frontend'),       // Electron production layout
    path.join(__dirname, '../../../frontend'),
  ];

  let frontendPath = '';
  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, 'index.html'))) {
      frontendPath = p;
      break;
    }
  }

  if (!frontendPath) {
    console.warn('[Backend Warning] Static frontend directory not found. Searched paths:');
    possiblePaths.forEach(p => {
      console.warn(`  - Path: "${p}" | Exists: ${fs.existsSync(p)} | Has index.html: ${fs.existsSync(p) ? fs.existsSync(path.join(p, 'index.html')) : false}`);
    });
  }

  if (frontendPath) {
    console.log(`[Backend] Serving static frontend files from: ${frontendPath}`);
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(frontendPath));
    expressApp.get('*', (req: any, res: any, next: any) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  } else {
    console.warn('[Backend Warning] Static frontend directory not found. Remote devices won\'t be able to access the UI via this port.');
  }

  let port = Number(process.env.PORT || 3001);
  await app.listen(port, '0.0.0.0');
  console.log('--- RESTARTING MAXIKIOSCO PAULOS BACKEND ---');
  console.log('--- TIME: ' + new Date().toISOString() + ' ---');
  console.log(`
  ╔══════════════════════════════════════════╗
  ║     Maxikiosco Paulos POS - Backend      ║
  ╠══════════════════════════════════════════╣
  ║  🚀 Server running on port ${port}          ║
  ║  📡 WebSocket ready                      ║
  ║  🗄️  Database: SQLite                    ║
  ╚══════════════════════════════════════════╝
  `);
}

bootstrap().catch((err) => {
  const errorMsg = `[FATAL] Backend failed to start at ${new Date().toISOString()}\n${err?.stack || err}\n`;
  console.error(errorMsg);
  // Also write to a log file so Tauri can surface the error
  try {
    const logPath = path.join(process.cwd(), 'backend-startup-error.log');
    fs.appendFileSync(logPath, errorMsg);
  } catch {}
  process.exit(1);
});

