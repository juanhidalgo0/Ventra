import { useEffect, useState } from 'react';
import { create } from 'zustand';
import api from '../services/api';
import { usePlanStore, type PlanFeatures } from '../stores/planStore';
import { useBusinessStore, ALL_INTENTS, INTENT_AREA, type BusinessIntent } from '../stores/businessStore';
import { useOnlineOrders } from '../services/onlineStoreOrders';
import { loadStoreConfig } from '../services/onlineStore';
import { hasAnyBooking } from '../services/agenda';
import { posnetsSaved } from './setupProgress';

/**
 * Pocos pasos a propósito (3 a 5 por lo que hace el comercio): una lista larga abruma y nadie
 * la termina. Lo opcional (sumar cajeros, recargos) queda en Configuración.
 *
 * "Primeros pasos": lo que lleva a un comercio nuevo a usar Ventra de verdad, según lo que
 * hace (mostrador, online, turnos). Cada paso se detecta solo con datos reales (no se tilda a
 * mano), así el progreso no miente. Reemplaza al viejo "Configuración %" de la barra superior.
 */
export interface StartStep {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  /** Ruta de la app donde se hace el paso */
  to: string;
}

/** Lo que hace el comercio: lo que eligió, o (si nunca eligió) todo lo que incluye el plan. */
export function effectiveIntents(features: PlanFeatures, intents: BusinessIntent[] | null): BusinessIntent[] {
  const allowed = ALL_INTENTS.filter((i) => features[INTENT_AREA[i]]);
  const chosen = intents ? allowed.filter((i) => intents.includes(i)) : allowed;
  return chosen.length ? chosen : allowed;
}

interface Facts {
  products: number; users: number; hasSales: boolean; autoBackup: boolean;
  storeReady: boolean; storePublished: boolean;
  agendaReady: boolean; agendaOn: boolean; hasBooking: boolean;
}

export function buildStartSteps(intents: BusinessIntent[], f: Facts, mobile: boolean, isDesktopApp: boolean): StartStep[] {
  const settings = (tab: string) => (mobile ? `/settings/${tab}` : `/settings?tab=${tab}`);
  const steps: StartStep[] = [];
  if (intents.includes('mostrador')) {
    steps.push(
      { id: 'products', title: 'Cargá tus productos', hint: 'A mano, con el lector o importando una planilla', done: f.products > 0, to: '/products' },
      { id: 'sale', title: 'Hacé tu primera venta', hint: 'Abrí la caja y cobrá', done: f.hasSales, to: '/pos' },
      { id: 'payments', title: 'Revisá tus medios de cobro', hint: 'Posnets, Mercado Pago, transferencias', done: posnetsSaved(), to: settings('posnets') },
    );
    // El backup automático es de la PC (en la nube ya está resguardado)
    if (isDesktopApp) steps.push({ id: 'backup', title: 'Activá el backup automático', hint: 'Una copia diaria de tus datos', done: f.autoBackup, to: settings('backups') });
  }
  if (intents.includes('online')) {
    if (!intents.includes('mostrador')) steps.push({ id: 'products', title: 'Cargá tus productos', hint: 'Con foto y precio', done: f.products > 0, to: '/products' });
    steps.push(
      { id: 'store', title: 'Armá tu tienda', hint: 'Nombre, dirección web y WhatsApp', done: f.storeReady, to: '/online-store' },
      { id: 'publish', title: 'Publicala', hint: 'Que tus clientes ya puedan pedir', done: f.storePublished, to: '/online-store' },
    );
  }
  if (intents.includes('turnos')) {
    steps.push(
      { id: 'agenda', title: 'Cargá tus servicios y horarios', hint: 'Hay servicios típicos por rubro para arrancar', done: f.agendaReady, to: '/agenda' },
      { id: 'share', title: 'Activá los turnos y compartí tu link', hint: 'En tu WhatsApp, Instagram o estados', done: f.agendaOn && localStorage.getItem('agenda_link_shared') === '1', to: '/agenda' },
      { id: 'booking', title: 'Recibí tu primer turno', hint: 'Online o cargado a mano', done: f.hasBooking, to: '/agenda' },
    );
  }
  return steps;
}

/** Ocultar la lista es por equipo: el que la cierra en la PC la puede seguir viendo en el celular. */
export const useStartHidden = create<{ hidden: boolean; hide: () => void }>((set) => ({
  hidden: (() => { try { return localStorage.getItem('getting_started_hidden') === '1'; } catch { return false; } })(),
  hide: () => { try { localStorage.setItem('getting_started_hidden', '1'); } catch { /* */ } set({ hidden: true }); },
}));

/** Pasos con su estado. Se recalcula al navegar (refreshKey), así refleja lo que se acaba de hacer. */
export function useGettingStarted(enabled: boolean, mobile: boolean, refreshKey?: unknown) {
  const features = usePlanStore((s) => s.features);
  const planLoaded = usePlanStore((s) => s.loaded);
  const intents = useBusinessStore((s) => s.intents);
  const storeId = useOnlineOrders((s) => s.storeId);
  const [steps, setSteps] = useState<StartStep[] | null>(null);
  const mine = effectiveIntents(features, intents);
  const key = mine.join(',');

  useEffect(() => {
    if (!enabled || !planLoaded) return;
    let alive = true;
    const isDesktopApp = !!(window as any).__TAURI__ || ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    const needsStore = mine.includes('online') || mine.includes('turnos');
    (async () => {
      const [act, backup, cfg, booked] = await Promise.all([
        api.get('/settings/activation', { silent: true } as any).then((r) => r.data).catch(() => null),
        mine.includes('mostrador') && isDesktopApp
          ? api.get('/system/backup/settings', { silent: true } as any).then((r) => !!r.data?.autoBackupEnabled).catch(() => false)
          : Promise.resolve(false),
        needsStore && storeId ? loadStoreConfig(storeId).catch(() => null) : Promise.resolve(null),
        mine.includes('turnos') && storeId ? hasAnyBooking(storeId).catch(() => false) : Promise.resolve(false),
      ]);
      if (!alive) return;
      const agenda = (cfg as any)?.agenda;
      setSteps(buildStartSteps(mine, {
        products: act?.products || 0, users: act?.users || 0, hasSales: !!act?.hasSales, autoBackup: backup,
        storeReady: !!(cfg?.subdomain && cfg?.businessName), storePublished: !!cfg?.isPublished,
        agendaReady: !!(agenda?.services?.length && agenda?.staff?.length), agendaOn: !!agenda?.enabled, hasBooking: booked,
      }, mobile, isDesktopApp));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, planLoaded, key, storeId, mobile, refreshKey]);

  const done = steps ? steps.filter((s) => s.done).length : 0;
  const total = steps ? steps.length : 0;
  return { steps, done, total, percent: total ? Math.round((done / total) * 100) : 100, complete: !!steps && done === total };
}
