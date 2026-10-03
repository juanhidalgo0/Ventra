import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search, Zap, PauseCircle, History, Calculator, Printer, HandCoins, ReceiptText,
  TrendingDown, Vault, Truck, User, Maximize2, Settings, ShoppingBag, LayoutDashboard,
  Package, Tag, ShoppingCart, ClipboardCheck, Wallet, Users, Receipt, BarChart3,
  FileText, Globe, CornerDownLeft, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore } from '../../stores/planStore';
import { useBusinessStore, menuAllows } from '../../stores/businessStore';
import { lockShortcuts, shortcutsLocked } from '../../utils/shortcutLock';
import Kbd from './Kbd';

// Paleta de comandos (Ctrl+K): buscar cualquier acción o pantalla escribiendo.
// Las acciones del POS no se duplican: la paleta dispara el mismo atajo de
// teclado (F1…F12) que ya manejan POSScreen, MainLayout y App, así que el
// comportamiento, los permisos y los avisos ("No hay caja abierta") son idénticos.

type Command = {
  id: string;
  label: string;
  group: 'Punto de venta' | 'Ir a';
  icon: LucideIcon;
  keys?: string;
  keywords?: string;
  run: () => void;
};

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function pressKey(key: string, shiftKey = false) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const planFeatures = usePlanStore((s) => s.features);
  const intents = useBusinessStore((s) => s.intents);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const onPOS = location.pathname === '/pos';
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
      // Con el cobro abierto (u otra ventana que bloquea atajos) no se abre encima
      if (!open && shortcutsLocked()) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  // Mientras está abierta, los F-keys de la pantalla de atrás quedan quietos
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    return lockShortcuts();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (onPOS) {
      const pos: [string, string, LucideIcon, string, string?, boolean?][] = [
        ['Venta rápida', 'F1', Zap, 'sin codigo precio libre'],
        ['Pausar ticket', 'F2', PauseCircle, 'espera guardar'],
        ['Tickets en espera', 'F2', History, 'pausados retomar', 'Shift F2', true],
        ['Calculadora', 'F3', Calculator, 'cuenta'],
        ['Reimprimir último ticket', 'F4', Printer, 'imprimir comprobante'],
        ['Cuentas corrientes', 'F5', HandCoins, 'fiado cobrar deuda cliente'],
        ['Historial de ventas', 'F6', ReceiptText, 'tickets anular'],
        ['Registrar gasto', 'F7', TrendingDown, 'egreso retiro'],
        ['Caja', 'F8', Vault, 'abrir cerrar arqueo turno'],
        ['Proveedores', 'F9', Truck, 'pago compra'],
        ['Mi usuario', 'F10', User, 'contraseña perfil'],
        ['Pantalla completa', 'F11', Maximize2, 'fullscreen'],
        // Visible también para el cajero: F12 le pide la clave de admin, así el
        // dueño entra al panel sin cerrar la sesión del cajero.
        ['Panel de administración', 'F12', Settings, 'admin dashboard configuracion'],
      ];
      pos.forEach(([label, key, icon, keywords, keysLabel, shift]) => {
        list.push({
          id: `pos-${label}`, label, group: 'Punto de venta', icon, keywords,
          keys: keysLabel || key,
          run: () => pressKey(key, !!shift),
        });
      });
    }

    // Las pantallas del panel solo se ofrecen a un usuario administrador.
    if (isAdmin) {
      const go: [string, string, LucideIcon, string?][] = [
        ['Punto de venta', '/pos', ShoppingBag, 'vender caja pos'],
        ['Dashboard', '/dashboard', LayoutDashboard, 'inicio resumen metricas'],
        ['Productos', '/products', Package, 'inventario articulos precios'],
        ['Promociones y combos', '/promos', Tag, 'ofertas'],
        ['Compras', '/purchases', ShoppingCart, 'mercaderia factura proveedor'],
        ['Control de stock', '/stock-control', ClipboardCheck, 'faltantes bajo stock'],
        ['Control de caja', '/cash-control', Wallet, 'cierres turnos arqueo'],
        ['Cuentas corrientes', '/clients', Users, 'clientes fiado deudas'],
        ['Proveedores', '/suppliers', Truck],
        ['Gastos', '/gastos', Receipt, 'egresos'],
        ['Historial de ventas', '/historial', History, 'tickets'],
        ['Reportes', '/reports', BarChart3, 'estadisticas ganancias'],
        ['Facturación', '/fiscal', FileText, 'arca afip factura electronica'],
        ['Tienda online', '/online-store', Globe, 'web catalogo'],
        ['Configuración', '/settings', Settings, 'ajustes opciones'],
      ];
      go.filter(([, path]) => path !== location.pathname && menuAllows(planFeatures, intents, path))
        .forEach(([label, path, icon, keywords]) => {
          list.push({ id: `go-${path}`, label, group: 'Ir a', icon, keywords, run: () => navigate(path) });
        });
    }
    return list;
  }, [onPOS, isAdmin, location.pathname, planFeatures, navigate]);

  const results = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length) return commands;
    return commands.filter((c) => {
      const hay = normalize(`${c.label} ${c.keywords || ''} ${c.keys || ''}`);
      return words.every((w) => hay.includes(w));
    });
  }, [commands, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-cmd-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runCommand = (cmd: Command) => {
    setOpen(false);
    // Se ejecuta después de soltar el bloqueo de atajos (efecto de cierre)
    setTimeout(cmd.run, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // La paleta atiende sus teclas y no deja que lleguen a la pantalla de atrás
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) runCommand(results[active]); }
  };

  let lastGroup = '';

  return (
    <div
      className="fixed inset-0 z-[200] bg-slate-900/40 flex items-start justify-center pt-[12vh] px-4 anim-veil"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Buscar acciones"
        className="w-full max-w-[560px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden anim-pop"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 h-14 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-[18px] h-[18px] text-slate-400 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={onPOS ? 'Buscá una acción: gastos, caja, historial…' : 'Buscá una pantalla o acción…'}
            className="flex-1 bg-transparent outline-none text-[15px] font-medium text-slate-900 dark:text-white placeholder:text-slate-400 placeholder:font-normal"
            autoComplete="off"
            spellCheck={false}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[min(420px,60vh)] overflow-y-auto custom-scrollbar p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">No hay nada que coincida con “{query}”.</p>
          ) : results.map((cmd, i) => {
            const header = cmd.group !== lastGroup ? cmd.group : null;
            lastGroup = cmd.group;
            const Icon = cmd.icon;
            const isActive = i === active;
            return (
              <div key={cmd.id}>
                {header && (
                  <p className="px-3 pt-2.5 pb-1.5 text-[11.5px] font-semibold text-slate-400 dark:text-slate-500">{header}</p>
                )}
                <button
                  type="button"
                  data-cmd-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runCommand(cmd)}
                  className={`w-full flex items-center gap-3 px-3 h-10 rounded-lg text-left text-sm cursor-pointer transition-colors duration-fast ${
                    isActive ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`} strokeWidth={2.1} />
                  <span className="flex-1 truncate font-medium">{cmd.label}</span>
                  {cmd.keys && <Kbd>{cmd.keys}</Kbd>}
                  {isActive && !cmd.keys && <CornerDownLeft className="w-3.5 h-3.5 text-slate-400" />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 px-4 h-10 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-[11.5px] text-slate-500">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> moverse</span>
          <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd> elegir</span>
          <span className="ml-auto flex items-center gap-1.5"><Kbd>Ctrl K</Kbd> abrir y cerrar</span>
        </div>
      </div>
    </div>
  );
}
