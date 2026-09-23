import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Caja para vender desde el celular, igual que en el POS: la sesión abierta es la
 * del usuario (si el dueño ya tiene una caja abierta en otra terminal, se usa esa).
 * Si no tiene ninguna, se abre una nueva a nombre de la terminal de este celular.
 */
export function useCashSession() {
  const [terminalName, setTerminalName] = useState<string | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (name: string) => {
    try {
      const { data } = await api.get('/cash/current', { params: { terminalName: name } });
      setSession(data || null);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let uuid = localStorage.getItem('terminal_uuid');
    if (!uuid) {
      uuid = 'term_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('terminal_uuid', uuid);
    }
    api.get(`/cash/terminal-name?terminalId=${uuid}`)
      .then(({ data }) => data.terminalName)
      .catch(() => 'Terminal 1')
      .then((name: string) => { setTerminalName(name); load(name); });
  }, [load]);

  const open = useCallback(async (openingAmount = 0) => {
    if (!terminalName) return;
    const { data } = await api.post('/cash/open', { terminalName, openingAmount, openingNotes: 'Abierta desde el celular' });
    setSession(data);
    return data;
  }, [terminalName]);

  const refresh = useCallback(() => { if (terminalName) load(terminalName); }, [terminalName, load]);

  return { terminalName, session, loading, open, refresh };
}
