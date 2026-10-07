import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

import { Eye, EyeOff, Loader2, ArrowLeft, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import AuthLayout, { authInput, authLead, authPrimaryButton, authTitle } from './AuthLayout';
import AdminRecovery from './AdminRecovery';
import { usePlanStore, PLANS, type PlanId } from '../../stores/planStore';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isInitialized, setIsInitialized] = useState(true);
  const [checkLoading, setCheckLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [demoLoading, setDemoLoading] = useState<PlanId | null>(null);
  // Las landings por rubro mandan a la demo con ?plan= (ej. /peluquerias → agenda): ese plan va marcado
  const [demoSuggested] = useState<PlanId>(() => {
    const p = new URLSearchParams(window.location.search).get('plan') as PlanId | null;
    return p && PLANS[p] ? p : 'full';
  });
  const [showBackToSetup, setShowBackToSetup] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const [loadingMessage, setLoadingMessage] = useState('Abriendo la base de datos…');

  const { login, supportLogin, isLoading } = useAuthStore();
  const navigate = useNavigate();
  // Sesión de soporte abierta desde ventra.store/admin en esta pestaña
  const [supportAvailable, setSupportAvailable] = useState(false);

  const enterAsSupport = () => {
    const rawHost = window.location.hostname;
    return supportLogin()
      .then(() => {
        const host = window.location.port ? `${rawHost}:${window.location.port}` : rawHost;
        localStorage.setItem('server_ip', host);
        localStorage.setItem('saved_client_ip', host);
        localStorage.setItem('connection_mode', 'CLIENT');
        navigate('/pos');
      })
      .catch((err: any) => toast.error(err?.message || 'No se pudo entrar como soporte'));
  };

  useEffect(() => {
    const rawHost = window.location.hostname;
    const isLocalDesktopContext = !rawHost || rawHost === 'localhost' || rawHost === '127.0.0.1' || rawHost.includes('tauri') || rawHost.endsWith('.localhost');
    // Only show "back to server selection" when the user actually went through
    // that screen (desktop app choosing Iniciar Servidor / Conectar Cliente) —
    // irrelevant on the public web/demo deployment, which has no /setup flow.
    setShowBackToSetup(isLocalDesktopContext && !!localStorage.getItem('connection_mode'));

    // Deployed as a normal website: the backend is the same origin that served this
    // page (see services/api.ts), so just ask it directly instead of port-scanning
    // http://<domain>:3001-3005 — that scan can never succeed off a real domain and
    // used to leave this screen "loading" for up to 150 seconds before falling back.
    if (!isLocalDesktopContext) {
      // Soporte desde ventra.store/admin: el anfitrión de la nube ya validó el acceso,
      // así que se entra directo como el administrador del comercio, una sola vez por
      // pestaña. Si después se cierra la sesión, el login queda libre para probar otro
      // usuario (antes volvía a entrar solo como administrador y no había forma).
      // Fuera de la caja en la nube (la demo, por ejemplo) esa ruta no existe y vuelve
      // la página de la app en vez de JSON: se ignora sin avisar nada.
      fetch('/_ventra/whoami', { credentials: 'same-origin' })
        .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('application/json') ? r.json() : null))
        .catch(() => null)
        .then((who) => {
          if (!who?.support) return;
          setSupportAvailable(true);
          try {
            if (sessionStorage.getItem('ventra_support_entered')) return;
            sessionStorage.setItem('ventra_support_entered', '1');
          } catch { /* sin almacenamiento: se entra igual */ }
          return enterAsSupport();
        });

      Promise.all([
        api.get('/auth/init-status').then(({ data }) => setIsInitialized(data.initialized)),
        api.get('/system/info').then(({ data }) => setIsDemo(!!data.isDemo)).catch(() => {}),
      ])
        .catch(() => setIsInitialized(true))
        .finally(() => setCheckLoading(false));
      return;
    }

    let retries = 0;
    const maxRetries = 150; // Extended retries for slow systems/first extract

    const detectPortAndCheckInit = async () => {
      const savedPort = sessionStorage.getItem('active_backend_port');
      const basePorts = [3001, 3002, 3003, 3004, 3005];
      const portsToTry = savedPort ? Array.from(new Set([parseInt(savedPort), ...basePorts])) : basePorts;

      const host = '127.0.0.1';

      for (const p of portsToTry) {
        try {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 200); // Fast 200ms ping
          const response = await fetch(`http://${host}:${p}/api/auth/init-status`, { signal: controller.signal });
          clearTimeout(id);
          
          if (response.ok) {
            const data = await response.json();
            console.log(`[Frontend] Successfully connected to backend on port: ${p}`);
            sessionStorage.setItem('active_backend_port', p.toString());
            setIsInitialized(data.initialized);
            setCheckLoading(false);
 
            // Fetch local IP (show toast with connection address if server mode)
            try {
              const infoRes = await fetch(`http://${host}:${p}/api/system/info`);
              if (infoRes.ok) {
                const infoData = await infoRes.json();
                console.log(`[Frontend] Server local IP detected: ${infoData.localIp}`);
                const isServerMode = localStorage.getItem('connection_mode') !== 'CLIENT';
                if (isServerMode && infoData.localIp && infoData.localIp !== 'localhost') {
                  toast.success(
                    `Caja lista. Para sumar otra PC, usá la dirección ${infoData.localIp}`, 
                    { duration: 8000, id: 'server-started-toast' }
                  );
                }
              }
            } catch (err) {
              console.error('Error fetching system info:', err);
            }
            return; // Success! Stop retrying
          }
        } catch (e) {
          // Port not active, check next one
        }
      }

      // If no port responded, schedule next retry in 1s
      retries++;
      console.warn(`[Frontend] Backend not ready on ports 3001-3005, retry #${retries}...`);

      if (retries >= 35) {
        setLoadingMessage('Sigue cargando. Si pasa más de un minuto, cerrá Ventra y volvé a abrirlo.');
      } else if (retries >= 20) {
        setLoadingMessage('Ya casi está: cargando tus productos y ventas…');
      } else if (retries >= 5) {
        setLoadingMessage('La primera vez tarda un poco más: estamos preparando todo.');
      } else {
        setLoadingMessage('Abriendo la base de datos…');
      }

      if (retries < maxRetries) {
        setTimeout(detectPortAndCheckInit, 1000);
      } else {
        setCheckLoading(false); // Fallback to show login if server fails permanently
      }
    };

    detectPortAndCheckInit();
  }, []);

  // Demo: el visitante elige qué plan probar; queda en su navegador (el servidor es compartido)
  const handleDemoLogin = async (plan: PlanId) => {
    setDemoLoading(plan);
    try {
      usePlanStore.getState().setDemoPlan(plan);
      await login('ADMIN', '1234');
      navigate('/pos');
    } catch (err: any) {
      toast.error(err.message || 'No se pudo entrar a la demo');
    } finally {
      setDemoLoading(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      navigate('/pos');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRegisterFirstAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    try {
      await api.post('/auth/register-first-admin', { username, password });
      toast.success('¡Administrador creado con éxito!');
      await login(username, password);
      navigate('/pos');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al registrar administrador');
    } finally {
      setRegistering(false);
    }
  };

  const changeSetup = showBackToSetup ? (
    <button
      type="button"
      onClick={() => { localStorage.removeItem('server_ip'); localStorage.removeItem('connection_mode'); navigate('/setup'); }}
      className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> Cambiar cómo se usa esta PC
    </button>
  ) : undefined;
  const step = showBackToSetup ? 2 : undefined;

  if (checkLoading) {
    return (
      <AuthLayout step={step}>
        <section className="select-none">
          <h2 className={authTitle}>Abriendo la caja</h2>
          <p key={loadingMessage} className={`${authLead} anim-rise`}>{loadingMessage}</p>
          <div className="mt-8 relative h-[3px] w-full bg-slate-100 rounded-full overflow-hidden">
            {/* Barra indeterminada en CSS (transform): se mueve en cualquier modo */}
            <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-rose-600 anim-indeterminate" />
          </div>
          <p className="mt-3 text-[13px] text-slate-500">No cierres la aplicación, tarda unos segundos.</p>
        </section>
      </AuthLayout>
    );
  }

  const passwordField = (id: string | undefined, placeholder: string) => (
    <div className="relative mt-2">
      <input
        id={id}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={placeholder}
        className={`${authInput} pr-11`}
        required
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
      >
        {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
      </button>
    </div>
  );

  return (
    <AuthLayout step={step} headerAction={changeSetup}>
      {!isInitialized ? (
        <section>
          <h2 className={authTitle}>Creá el usuario administrador</h2>
          <p className={authLead}>Es el usuario del dueño: con él se configura todo y se dan de alta los empleados. Hay uno solo por comercio.</p>

          <form onSubmit={handleRegisterFirstAdmin} className="mt-8 space-y-5">
            <div>
              <label htmlFor="admin-username" className="block text-[13px] font-medium text-slate-700">Usuario</label>
              <input id="admin-username" type="text" value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} placeholder="Por ejemplo, el nombre del comercio" className={`${authInput} mt-2`} autoFocus required />
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-[13px] font-medium text-slate-700">Contraseña</label>
              {passwordField('admin-password', 'Mejor solo números, así la cargás rápido')}
            </div>
            <button type="submit" disabled={registering || !username || !password} className={`${authPrimaryButton} mt-2`}>
              {registering ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando…</> : 'Crear y continuar'}
            </button>
          </form>
        </section>
      ) : (
        <section>
          {isDemo && (
            <div className="mb-10">
              <h2 className={authTitle}>Probá Ventra</h2>
              <p className={authLead}>Elegí un plan y entrás con un clic, sin registrarte. Adentro lo podés cambiar cuando quieras.</p>
              <div className="mt-6 rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
                {(['caja', 'tienda', 'agenda', 'agenda_pro', 'full'] as PlanId[]).map((id) => (
                  <button key={id} type="button" onClick={() => handleDemoLogin(id)} disabled={!!demoLoading}
                    className="group w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer">
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold">{PLANS[id].name}</span>
                        {id === demoSuggested && <span className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-100 rounded-full px-2 py-px">Sugerido</span>}
                      </span>
                      <span className="block text-[13px] text-slate-500 leading-snug mt-0.5">{PLANS[id].tagline}</span>
                    </span>
                    {demoLoading === id
                      ? <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" />
                      : <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-900 transition-colors shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <h2 className={isDemo ? 'text-[17px] font-semibold tracking-tight' : authTitle}>{isDemo ? 'O ingresá con un usuario' : 'Ingresá a la caja'}</h2>
          {isDemo
            ? <p className="mt-1 text-[13px] text-slate-500">Usuario de prueba: <span className="font-mono">ADMIN</span> · contraseña <span className="font-mono">1234</span></p>
            : <p className={authLead}>Con tu usuario y contraseña. Cada uno entra con el suyo, así las ventas quedan a su nombre.</p>}

          <form onSubmit={handleSubmit} className={`${isDemo ? 'mt-5' : 'mt-8'} space-y-5`}>
            <div>
              <label htmlFor="login-username" className="block text-[13px] font-medium text-slate-700">Usuario</label>
              <input id="login-username" type="text" value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} className={`${authInput} mt-2`} autoComplete="username" autoFocus={!isDemo} required />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-[13px] font-medium text-slate-700">Contraseña</label>
              {passwordField('login-password', '')}
            </div>
            <button id="login-submit" type="submit" disabled={isLoading || !username || !password} className={`${authPrimaryButton} mt-2`}>
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Ingresando…</> : 'Iniciar turno'}
            </button>
          </form>

          {(!isDemo || supportAvailable) && (
            <div className="mt-6 flex flex-col items-start gap-2 text-[13px]">
              {!isDemo && (
                <button type="button" onClick={() => setRecovering(true)} className="text-slate-500 hover:text-slate-900 transition-colors cursor-pointer">
                  ¿Olvidaste la contraseña del administrador?
                </button>
              )}
              {supportAvailable && (
                <button type="button" onClick={enterAsSupport} disabled={isLoading} className="text-amber-700 hover:text-amber-800 transition-colors cursor-pointer disabled:opacity-50">
                  Volver a entrar como soporte (administrador)
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {recovering && <AdminRecovery onClose={() => setRecovering(false)} />}
    </AuthLayout>
  );
}
