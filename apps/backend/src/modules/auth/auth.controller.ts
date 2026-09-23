import { Controller, Post, Body, Get, UseGuards, Request, BadRequestException, Header } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { LicenseService } from './license.service';

class LoginDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() password: string;
  /** App instalada en el celular del dueño: la sesión dura meses en lugar de 7 días */
  @IsOptional() @IsBoolean() longSession?: boolean;
}

class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken: string;
}

class GoogleLoginDto {
  @IsString() @IsNotEmpty() idToken: string;
}

class RegisterFirstAdminDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() password: string;
}

class ChangePasswordDto {
  @IsString() @IsNotEmpty() oldPassword: string;
  @IsString() @IsNotEmpty() newPassword: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private googleAuthService: GoogleAuthService,
    private licenseService: LicenseService
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password, !!dto.longSession);
  }

  @Post('google')
  async googleLogin(@Body() dto: GoogleLoginDto) {
    return this.googleAuthService.loginWithGoogle(dto.idToken);
  }

  @Post('google-link-verify')
  async verifyGoogleLink(@Body() dto: { email: string }) {
    if (!dto.email) {
      throw new BadRequestException('El email es obligatorio');
    }
    const isOwner = await this.googleAuthService.verifyGoogleEmailLink(dto.email);
    if (!isOwner) {
      throw new BadRequestException('Este correo no pertenece al propietario del comercio configurado en esta terminal.');
    }
    return { success: true };
  }

  @Get('google-link-status')
  async getGoogleLinkStatus() {
    const user = this.googleAuthService.getLinkedGoogleUser();
    if (user) {
      this.googleAuthService.clearLinkedGoogleUser();
      return { linked: true, user };
    }
    return { linked: false };
  }

  @Post('google-link-callback')
  async googleLinkCallback(@Body() dto: { idToken: string }) {
    if (!dto.idToken) {
      throw new BadRequestException('Token de Google requerido');
    }
    try {
      const payload = await this.googleAuthService.verifyToken(dto.idToken);
      const email = payload.email;
      if (!email) {
        throw new BadRequestException('El token no contiene un email válido.');
      }
      const isOwner = await this.googleAuthService.verifyGoogleEmailLink(email);
      if (!isOwner) {
        throw new BadRequestException('Este correo no pertenece al propietario de la tienda de esta terminal.');
      }
      const userPayload = {
        name: payload.name || payload.given_name || email.split('@')[0],
        email: email,
        picture: payload.picture || ''
      };
      this.googleAuthService.setLinkedGoogleUser(userPayload);
      return { success: true, user: userPayload };
    } catch (err: any) {
      throw new BadRequestException('Error al verificar el token de Google: ' + err.message);
    }
  }

  @Get('google/login-page')
  @Header('Content-Type', 'text/html')
  getGoogleLoginPage() {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Vincular Google con Ventra</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@450;600;800&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Inter', sans-serif;
              background-color: #f8fafc;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              box-sizing: border-box;
            }
            .card {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
              max-width: 400px;
              width: 100%;
              text-align: center;
              border: 1px solid #f1f5f9;
            }
            h1 {
              font-size: 24px;
              color: #0f172a;
              margin-bottom: 8px;
              font-weight: 800;
            }
            p {
              font-size: 14px;
              color: #64748b;
              line-height: 1.5;
              margin-bottom: 24px;
            }
            .btn-container {
              display: flex;
              justify-content: center;
              margin-top: 20px;
            }
            .btn-google {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              background-color: #ffffff;
              color: #1f2937;
              font-weight: 600;
              font-size: 15px;
              padding: 12px 24px;
              border-radius: 12px;
              border: 1px solid #e5e7eb;
              cursor: pointer;
              transition: all 0.2s ease;
              box-shadow: 0 1px 3px 0 rgba(0,0,0,0.1);
              text-decoration: none;
              font-family: 'Inter', sans-serif;
            }
            .btn-google:hover {
              background-color: #f9fafb;
              border-color: #d1d5db;
              box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
            }
            .btn-google svg {
              width: 20px;
              height: 20px;
              margin-right: 12px;
            }
            .success-msg {
              display: none;
              color: #10b981;
              font-weight: 600;
              font-size: 15px;
            }
          </style>
        </head>
        <body>
          <div class="card" id="login-card">
            <h1 id="title">Vincular con GoDelivery</h1>
            <p id="desc">Inicia sesión con tu cuenta de Google del comercio para verificar e iniciar la sincronización.</p>
            <div class="btn-container" id="btn-container">
              <button class="btn-google" id="google-btn">
                <svg viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.67 1.55 15 0 12 0 7.35 0 3.39 2.67 1.45 6.57l3.9 3.03C6.27 6.84 8.92 5.04 12 5.04z"/>
                  <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.43c-.28 1.44-1.09 2.67-2.32 3.5l3.58 2.78c2.1-1.94 3.3-4.79 3.3-7.93z"/>
                  <path fill="#FBBC05" d="M5.35 14.77C5.12 14.07 5 13.34 5 12.58s.12-1.49.35-2.19L1.45 7.36C.67 8.93.22 10.7.22 12.58s.45 3.65 1.23 5.22l3.9-3.03z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.58-2.78c-.99.66-2.26 1.06-3.9 1.06-3.08 0-5.73-1.8-6.66-4.52L1.45 17.88C3.39 21.78 7.35 24 12 24z"/>
                </svg>
                Iniciar sesión con Google
              </button>
            </div>
            <div id="success" class="success-msg">
              <svg xmlns="http://www.w3.org/2000/svg" style="width:48px;height:48px;margin:0 auto 16px auto;display:block;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" stroke="#10b981">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              ¡Vinculado con éxito!<br>
              <span style="font-size: 12px; color: #64748b; font-weight: normal; margin-top: 8px; display: block;">Ya puedes cerrar esta ventana y regresar a la aplicación.</span>
            </div>
          </div>

          <script type="module">
            import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
            import { getAuth, signInWithPopup, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

            const firebaseConfig = {
              apiKey: "${process.env.FIREBASE_API_KEY || ''}",
              authDomain: "${process.env.FIREBASE_AUTH_DOMAIN || ''}",
              projectId: "${process.env.FIREBASE_PROJECT_ID || ''}",
              storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET || ''}",
              messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID || ''}",
              appId: "${process.env.FIREBASE_APP_ID || ''}"
            };

            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });

            document.getElementById('google-btn').addEventListener('click', () => {
              document.getElementById('google-btn').style.display = 'none';
              document.getElementById('desc').innerText = 'Abriendo ventana de inicio de sesión de Google...';
              document.getElementById('desc').style.color = '#64748b';

              signInWithPopup(auth, provider)
                .then((result) => {
                  const credential = GoogleAuthProvider.credentialFromResult(result);
                  const googleIdToken = credential.idToken;
                  if (!googleIdToken) {
                    throw new Error("No se pudo obtener el token de Google del proveedor de Firebase. Inténtalo de nuevo.");
                  }
                  
                  document.getElementById('desc').innerText = 'Validando cuenta de Google con el sistema...';
                  return fetch('/api/auth/google-link-callback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken: googleIdToken })
                  });
                })
                .then(res => {
                  if (!res.ok) {
                    return res.json().then(err => { throw new Error(err.message || 'Error de validación'); });
                  }
                  return res.json();
                })
                .then(data => {
                  document.getElementById('title').style.display = 'none';
                  document.getElementById('desc').style.display = 'none';
                  document.getElementById('success').style.display = 'block';
                })
                .catch(err => {
                  document.getElementById('google-btn').style.display = 'inline-flex';
                  document.getElementById('desc').innerText = err.message || 'Error al validar cuenta. Inténtalo de nuevo.';
                  document.getElementById('desc').style.color = '#ef4444';
                });
            });
          </script>
        </body>
      </html>
    `;
  }

  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Get('init-status')
  async getInitStatus() {
    return this.authService.getInitStatus();
  }

  @Post('register-first-admin')
  async registerFirstAdmin(@Body() dto: RegisterFirstAdminDto) {
    return this.authService.registerFirstAdmin(dto.username, dto.password, dto.username);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Request() req) {
    return this.authService.validateUser(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.sub, dto.oldPassword, dto.newPassword);
  }

  @Get('license/status')
  async getLicenseStatus() {
    return this.licenseService.getLicenseStatus();
  }

  @Get('license/dev-reset')
  async devResetLicense() {
    await this.licenseService.devResetLicense();
    return { success: true, message: 'License reset successfully. PC is now blocked.' };
  }

  @Post('license/activate')
  async activateLicense(@Body() dto: { code: string }) {
    const success = await this.licenseService.activateWithCode(dto.code);
    if (!success) {
      throw new BadRequestException('Código de activación inválido para esta computadora');
    }
    return { success: true };
  }
}
