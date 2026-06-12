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

  // Serve static files from frontend/dist
  const express = require('express');
  let frontendPath = path.join(__dirname, '../../frontend/dist');
  if (!fs.existsSync(frontendPath)) {
    frontendPath = path.join(__dirname, '../frontend/dist');
  }

  if (fs.existsSync(frontendPath)) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(frontendPath));
    expressApp.get('*', (req: any, res: any, next: any) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }

  let port = Number(process.env.PORT || 3001);
  const maxPort = port + 20;

  async function startServer(targetPort: number) {
    try {
      await app.listen(targetPort, '0.0.0.0');
      console.log('--- RESTARTING MAXIKIOSCO PAULOS BACKEND ---');
      console.log('--- TIME: ' + new Date().toISOString() + ' ---');
      console.log(`
      ╔══════════════════════════════════════════╗
      ║     Maxikiosco Paulos POS - Backend      ║
      ╠══════════════════════════════════════════╣
      ║  🚀 Server running on port ${targetPort}          ║
      ║  📡 WebSocket ready                      ║
      ║  🗄️  Database: SQLite                    ║
      ╚══════════════════════════════════════════╝
      `);
    } catch (err: any) {
      if (err.code === 'EADDRINUSE' && targetPort < maxPort) {
        console.warn(`[Nest] Port ${targetPort} is in use. Trying port ${targetPort + 1}...`);
        await startServer(targetPort + 1);
      } else {
        throw err;
      }
    }
  }

  await startServer(port);
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

