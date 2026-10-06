import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Store, Globe, CalendarDays, Lock, Check, ArrowLeft } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore, isAgendaOnly } from '../../stores/planStore';
import {
  useBusinessStore, ALL_INTENTS, INTENT_AREA, INTENT_LABELS, PROFILE_LABELS, type BusinessIntent, type BusinessProfile,
} from '../../stores/businessStore';
import { setStoreSetting, whenStoreSettingsReady } from '../../services/storeSettings';
import { useTourStore } from '../common/tour/tourStore';
import { intentForRubro, profileForRubro } from '../../services/signupRubro';

const UPGRADE_URL = 'https://ventra.store/cuenta.html';
const INTENT_ICON: Record<BusinessIntent, any> = { mostrador: Store, online: Globe, turnos: CalendarDays };

function openUpgrade() {
  const tauri = (window as any).__TAURI__;
  const invoke = tauri?.core?.invoke || tauri?.invoke;
  if (invoke) invoke('open_browser', { url: UPGRADE_URL }).catch(() => window.open(UPGRADE_URL, '_blank'));
  else window.open(UPGRADE_URL, '_blank', 'noopener');
}

type Step = 'intent' | 'rubro' | 'name';

/**
 * Bienvenida del primer uso (solo el dueño, una vez por comercio): qué hace con Ventra, qué
 * vende y cómo se llama. Con eso se ordena el menú, se activan las funciones del rubro y se
 * arman los "Primeros pasos". Todo es salteable y se cambia después en Configuración.
 * No aparece en comercios que ya trabajan (con productos o ventas) ni en el plan Agenda,
 * que arranca directo armando su página de turnos.
 * Con la caja (planes Caja y Full) el rubro es obligatorio: define qué funciones y qué
 * recorridos ve el comercio. Si nunca se eligió (se salteó la bienvenida o el comercio ya
 * trabajaba), se pregunta solo eso.
 */

/** El rubro ya se eligió alguna vez en este comercio (o viene de la versión vieja). */
const rubroKnown = () => !!(localStorage.getItem('business_profile') || localStorage.getItem('business_type'));
export default function WelcomeSetup({ mobile }: { mobile: boolean }) {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const features = usePlanStore((s) => s.features);
  const planLoaded = usePlanStore((s) => s.loaded);
  const signupRubro = usePlanStore((s) => s.signupRubro);
  const { setProfile, setIntents } = useBusinessStore();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<Step>('intent');
  const allowed = ALL_INTENTS.filter((i) => features[INTENT_AREA[i]]);
  const [chosen, setChosen] = useState<BusinessIntent[]>([]);
  const [profile, setProfileChoice] = useState<BusinessProfile | null>(null);
  const [name, setName] = useState('');
  /** Solo falta el rubro (comercio que ya usaba Ventra o salteó la bienvenida) */
  const [rubroOnly, setRubroOnly] = useState(false);
  const setToursPaused = useTourStore((s) => s.setPaused);

  // Los recorridos esperan a la bienvenida: así no se abren encima y salen ya con el rubro
  useEffect(() => {
    if (role === 'ADMIN') setToursPaused(true);
    return () => setToursPaused(false);
  }, [role, setToursPaused]);

  useEffect(() => {
    if (role !== 'ADMIN' || !planLoaded) return;
    if (isAgendaOnly(features)) { setToursPaused(false); return; }
    let alive = true;
    // Si se suscribió desde una landing por rubro (/ropa, /kioscos…), ese rubro ya viene marcado
    const fromLanding = profileForRubro(signupRubro);
    const askRubro = () => { setRubroOnly(true); setProfileChoice(fromLanding); setStep('rubro'); setShow(true); };
    (async () => {
      await whenStoreSettingsReady();
      if (!alive) return;
      const needsRubro = features.caja && !rubroKnown();
      if (localStorage.getItem('onboarding_done') === '1') {
        if (needsRubro) askRubro(); else setToursPaused(false);
        return;
      }
      try {
        const { data } = await api.get('/settings/activation', { silent: true } as any);
        if (!alive) return;
        // Un comercio que ya trabaja no necesita la bienvenida entera: se marca hecha y, si
        // tiene caja y nunca eligió rubro, se le pregunta solo eso
        if (data.products > 0 || data.hasSales) {
          setStoreSetting('onboarding_done', '1');
          if (needsRubro) askRubro(); else setToursPaused(false);
          return;
        }
        const landingIntent = intentForRubro(signupRubro);
        setChosen(landingIntent && allowed.includes(landingIntent) ? [landingIntent] : allowed.includes('mostrador') ? ['mostrador'] : allowed.slice(0, 1));
        setProfileChoice(fromLanding);
        setName(localStorage.getItem('gd_store_name') || '');
        setStep(allowed.length > 1 ? 'intent' : 'rubro');
        setShow(true);
      } catch {
        // backend viejo o sin conexión: no se insiste con la bienvenida, pero el rubro sí
        if (alive && needsRubro) askRubro(); else setToursPaused(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, planLoaded, signupRubro, features.caja, features.tienda, features.agenda]);

  if (!show) return null;

  // Con caja el rubro siempre se pregunta (y no se puede saltear)
  const rubroRequired = features.caja;
  const sells = chosen.includes('mostrador') || chosen.includes('online') || rubroRequired;
  const flow: Step[] = rubroOnly
    ? ['rubro']
    : [...(allowed.length > 1 ? ['intent' as const] : []), ...(sells ? ['rubro' as const] : []), 'name'];
  const idx = flow.indexOf(step);
  const next = () => setStep(flow[idx + 1]);
  const back = () => setStep(flow[idx - 1]);

  const close = () => {
    setShow(false);
    setToursPaused(false);
  };

  const skip = () => {
    setStoreSetting('onboarding_done', '1');
    close();
  };

  const finish = () => {
    if (rubroOnly) {
      if (profile) setProfile(profile);
      close();
      toast.success(`Listo: activamos las funciones de ${PROFILE_LABELS[profile!].title}`, { duration: 4000 });
      return;
    }
    const intents = chosen.length ? chosen : allowed;
    setIntents(intents);
    // Siempre se guarda (aunque coincida con el de fábrica): así los otros equipos lo reciben
    if (sells && profile) setProfile(profile);
    if (name.trim().length >= 2) setStoreSetting('store_name', name.trim().slice(0, 60));
    setStoreSetting('onboarding_done', '1');
    close();
    toast.success('¡Listo! Te dejamos los primeros pasos para arrancar', { duration: 5000 });
    navigate(intents.includes('mostrador') ? (mobile ? '/inicio' : '/pos') : intents.includes('online') ? '/tienda' : '/agenda');
  };

  const toggle = (i: BusinessIntent) => setChosen((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  const canNext = step === 'intent' ? chosen.length > 0 : step === 'rubro' ? !!profile : true;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-900/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center">
      <div role="dialog" aria-modal="true" aria-labelledby="welcome-title"
        className={`w-full sm:max-w-xl bg-white flex flex-col shadow-2xl ${mobile ? 'h-[100dvh]' : 'max-h-[92dvh] rounded-3xl'}`}>
        <div className="px-6 pt-[calc(env(safe-area-inset-top)+20px)] sm:pt-6 flex items-center gap-3">
          {idx > 0 ? (
            <button onClick={back} className="w-9 h-9 -ml-2 rounded-full hover:bg-slate-100 flex items-center justify-center" aria-label="Volver"><ArrowLeft className="w-5 h-5 text-slate-600" /></button>
          ) : <span className="w-9" />}
          <div className="flex-1 flex justify-center gap-1.5">
            {flow.map((s, i) => <span key={s} className={`h-1.5 rounded-full transition-all ${i <= idx ? 'w-8 bg-rose-600' : 'w-4 bg-slate-200'}`} />)}
          </div>
          {rubroRequired ? <span className="w-9" /> : (
            <button onClick={skip} className="text-[13px] font-semibold text-slate-400 hover:text-slate-600 w-auto">Lo hago después</button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-4">
          {step === 'intent' && (
            <>
              <h2 id="welcome-title" className="text-[24px] font-bold text-slate-900 tracking-tight leading-tight">¡Bienvenido a Ventra! ¿Qué querés hacer?</h2>
              <p className="mt-1.5 text-[14px] text-slate-500">Elegí todo lo que corresponda. Te mostramos solo lo que vas a usar.</p>
              <div className="mt-5 space-y-2.5">
                {ALL_INTENTS.map((i) => {
                  const Icon = INTENT_ICON[i];
                  const locked = !allowed.includes(i);
                  const on = chosen.includes(i);
                  return (
                    <button key={i} onClick={() => (locked ? undefined : toggle(i))} aria-pressed={on} aria-disabled={locked}
                      className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-colors ${locked ? 'border-slate-200 bg-slate-50 cursor-default' : on ? 'border-rose-600 bg-rose-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                      <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${locked ? 'bg-slate-200 text-slate-400' : on ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600'}`}><Icon className="w-6 h-6" /></span>
                      <span className="flex-1 min-w-0">
                        <span className={`block text-[15.5px] font-bold ${locked ? 'text-slate-400' : 'text-slate-900'}`}>{INTENT_LABELS[i].title}</span>
                        <span className="block text-[13px] text-slate-500">{INTENT_LABELS[i].description}</span>
                        {locked && (
                          <span onClick={(e) => { e.stopPropagation(); openUpgrade(); }} className="inline-flex items-center gap-1 mt-1.5 text-[12.5px] font-semibold text-rose-700 hover:underline cursor-pointer">
                            <Lock className="w-3.5 h-3.5" /> Incluido en Ventra Full · Ver planes
                          </span>
                        )}
                      </span>
                      {!locked && <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-rose-600 text-white' : 'border-2 border-slate-300'}`}>{on && <Check className="w-4 h-4" strokeWidth={3} />}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 'rubro' && (
            <>
              <h2 id="welcome-title" className="text-[24px] font-bold text-slate-900 tracking-tight leading-tight">{rubroOnly ? 'Antes de seguir: ¿qué vendés?' : '¿Qué vendés?'}</h2>
              <p className="mt-1.5 text-[14px] text-slate-500">Activamos las funciones de tu rubro (talles y colores, venta por metro, vencimientos…) y te mostramos cómo usarlas. Lo podés cambiar después en Configuración.</p>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(Object.keys(PROFILE_LABELS) as BusinessProfile[]).map((p) => {
                  const info = PROFILE_LABELS[p];
                  const on = profile === p;
                  return (
                    <button key={p} onClick={() => setProfileChoice(p)} aria-pressed={on}
                      className={`flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-colors ${on ? 'border-rose-600 bg-rose-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                      <span className="text-[26px] leading-none mt-0.5">{info.emoji}</span>
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-bold text-slate-900">{info.title}</span>
                        <span className="block text-[12px] text-slate-500 leading-snug line-clamp-2">{info.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 'name' && (
            <>
              <h2 id="welcome-title" className="text-[24px] font-bold text-slate-900 tracking-tight leading-tight">¿Cómo se llama tu comercio?</h2>
              <p className="mt-1.5 text-[14px] text-slate-500">Sale en tus tickets, en los cierres de caja y en la app del celular.</p>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                onKeyDown={(e) => { if (e.key === 'Enter') finish(); }}
                placeholder="Ej.: Almacén Don Pepe"
                className="mt-5 w-full h-14 px-4 rounded-2xl bg-slate-50 border-2 border-slate-200 text-[17px] font-semibold text-slate-900 outline-none focus:border-rose-500 focus:bg-white" />
            </>
          )}
        </div>

        <div className="px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)] sm:pb-6 border-t border-slate-100">
          <button disabled={!canNext} onClick={idx === flow.length - 1 ? finish : next}
            className="w-full h-13 py-3.5 rounded-2xl bg-rose-600 text-white text-[16px] font-bold disabled:opacity-40 active:scale-[0.99] transition-transform">
            {rubroOnly ? 'Listo' : step === 'name' ? 'Empezar a usar Ventra' : 'Seguir'}
          </button>
        </div>
      </div>
    </div>
  );
}
