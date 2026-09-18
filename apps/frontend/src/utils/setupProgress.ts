import { useEffect } from 'react';
import { create } from 'zustand';
import api from '../services/api';

export type SetupTab = 'posnets' | 'personal' | 'backups';

export interface SetupStep {
  label: string;
  done: boolean;
  tab: SetupTab;
}

interface SetupInput {
  /** The user saved their own payment methods (not just the built-in defaults). */
  posnetsSaved: boolean;
  userCount: number;
  /** Saved on the server, not the unsaved toggle. */
  autoBackupEnabled: boolean;
  isAdmin: boolean;
}

/**
 * Pasos del "Terminá de configurarlo". Solo cuenta lo que queda guardado:
 * integraciones opcionales (Google) y el nombre del terminal (lo asigna el
 * sistema) no entran.
 */
export function buildSetupSteps(i: SetupInput): SetupStep[] {
  return [
    { label: 'Revisar medios de pago', done: i.posnetsSaved, tab: 'posnets' },
    ...(i.isAdmin
      ? [
          { label: 'Sumar a tu equipo', done: i.userCount > 1, tab: 'personal' as const },
          { label: 'Activar backup automático', done: i.autoBackupEnabled, tab: 'backups' as const },
        ]
      : []),
  ];
}

export function setupPercent(steps: SetupStep[]) {
  return steps.length ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100) : 100;
}

export function posnetsSaved() {
  return localStorage.getItem('posnet_configs') !== null;
}

/** One shared value, so the top bar and Configuración never disagree. */
export const useSetupStore = create<{ percent: number | null; setPercent: (p: number) => void }>((set) => ({
  percent: null,
  setPercent: (percent) => set({ percent }),
}));

/** Progreso para la barra superior. Configuración lo actualiza en vivo al cambiar algo. */
export function useSetupProgress(isAdmin: boolean, refreshKey?: unknown) {
  const percent = useSetupStore((s) => s.percent);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    Promise.all([
      api.get('/users').then((r) => (r.data || []).length).catch(() => 0),
      api.get('/system/backup/settings').then((r) => !!r.data?.autoBackupEnabled).catch(() => false),
    ]).then(([userCount, autoBackupEnabled]) => {
      if (!alive) return;
      useSetupStore.getState().setPercent(
        setupPercent(buildSetupSteps({ posnetsSaved: posnetsSaved(), userCount, autoBackupEnabled, isAdmin })),
      );
    });
    return () => { alive = false; };
  }, [isAdmin, refreshKey]);

  return percent;
}
