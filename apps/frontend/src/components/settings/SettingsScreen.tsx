import { useState, useEffect, useRef } from 'react';
import TicketPrinterCard from './TicketPrinterCard';
import FontSizeCard from './FontSizeCard';
import CursorSizeCard from './CursorSizeCard';
import TicketLookCard from './TicketLookCard';
import { useAutoTour } from '../common/tour/GuidedTour';
import { buildSetupSteps, setupPercent as calcSetupPercent, posnetsSaved, useSetupStore } from '../../utils/setupProgress';
import api from '../../services/api';
import { workRoleLabel } from '../../services/workRole';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store, Laptop, RotateCcw, AlertTriangle, ShieldAlert, CheckCircle2, Trash2, Database, Lock,
  Users, UserPlus, Plus, X, KeyRound, Pencil, Download, Clock, Check, Upload, Percent, Smartphone,
  Circle, ChevronRight, Sparkles, LayoutGrid, SlidersHorizontal, Wallet, CreditCard, Loader2,
} from 'lucide-react';
import SubscriptionPanel from '../subscription/SubscriptionPanel';
import CloudSyncPanel from '../subscription/CloudSyncPanel';
import MercadoPagoCard from './MercadoPagoCard';
import GoDeliveryCard from '../go/GoDeliveryCard';
import { useAuthStore } from '../../stores/authStore';
import { getOpeningFloat, saveOpeningFloat } from '../../utils/openingFloat';
import { setStoreSetting } from '../../services/storeSettings';
import StoreLogoField from '../common/StoreLogoField';
import ScaleSettingsCard from './ScaleSettingsCard';
import StaffDevicesCard from './StaffDevicesCard';
import UserFormModal, { type UserFormValues } from './UserFormModal';
import { useBusinessStore, ALL_FEATURES, FEATURE_LABELS, PROFILE_LABELS, featuresOfProfiles, ALL_INTENTS, INTENT_AREA, INTENT_LABELS, type BusinessProfile, type BusinessIntent } from '../../stores/businessStore';
import { usePlanStore } from '../../stores/planStore';
import { effectiveIntents } from '../../utils/gettingStarted';
import { VentriImg, getVentriCaja, saveVentriCaja, type VentriCaja } from '../common/Ventri';
import { SETTINGS_SECTIONS, FEATURE_GROUPS, normalizeSettingsTab, type SettingsTab } from './settingsSections';
import { SectionHeader, SettingsCard, GroupLabel, SettingRow, ToggleRow, Field, DangerAction, inputCls, toastSaved } from './SettingsUI';
import { undoable } from '../../utils/undo';

const RESTORE_TIMEOUT_MS = 15 * 60 * 1000;

const PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: 'CLOVER', label: 'Clover' },
  { id: 'MERCADOPAGO', label: 'Mercado Pago' },
  { id: 'DEBT', label: 'Cuenta corriente' },
];
const methodLabel = (m: string) => PAYMENT_METHODS.find((p) => p.id === m)?.label || m;

/** El administrador del comercio (hay uno solo): el usuario activo con rol ADMIN, el más antiguo si quedaran varios. */
function findStoreAdmin(list: any[]): any | null {
  const admins = list.filter((u) => u.role === 'ADMIN' && u.isActive !== false);
  admins.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return admins[0] || null;
}

/** Llama a la app de escritorio (Tauri) si está; en el navegador no hace nada. */
function tauriInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> | null {
  const t = (window as any).__TAURI__;
  const invokeFn = t?.core?.invoke || t?.invoke;
  return invokeFn ? invokeFn(cmd, args) : null;
}

/**
 * Configuración. embedded + initialTab: en la app del celular, cada sección se abre sola
 * (sin la columna de secciones), porque el índice lo muestra MobileSettingsScreen.
 */
export default function SettingsScreen({ initialTab, embedded = false }: { initialTab?: string; embedded?: boolean } = {}) {
  const { user, resetAdminUnlock, logout } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN' || localStorage.getItem('admin_unlocked') === 'true' || sessionStorage.getItem('admin_unlocked') === 'true';

  // Este equipo: el nombre lo asigna el servidor según el orden en que se conectó cada PC
  const [terminalUuid, setTerminalUuid] = useState('');
  const [terminalName, setTerminalName] = useState('Terminal 1');
  const [isLoading, setIsLoading] = useState(true);
  useAutoTour('settings', !isLoading);

  // Copias de seguridad
  const [backups, setBackups] = useState<any[]>([]);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [backupTime, setBackupTime] = useState('22:00');
  const [savedAutoBackup, setSavedAutoBackup] = useState(false);

  // Restauración
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingRestartMessage, setPendingRestartMessage] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedBackupToRestore, setSelectedBackupToRestore] = useState<string | null>(null);
  const [restoreConfirmWord, setRestoreConfirmWord] = useState('');
  const [uploadedFileToRestore, setUploadedFileToRestore] = useState<File | null>(null);

  // Datos del comercio: salen en tickets, cierres, notas de venta y remitos, en todos los equipos
  const [storeName, setStoreName] = useState(() => localStorage.getItem('gd_store_name') || '');
  const [storeAddress, setStoreAddress] = useState(() => localStorage.getItem('gd_store_address') || '');
  const [storePhone, setStorePhone] = useState(() => localStorage.getItem('gd_store_phone') || '');
  const [storeCuit, setStoreCuit] = useState(() => localStorage.getItem('gd_store_cuit') || '');
  const [storeIva, setStoreIva] = useState(() => localStorage.getItem('gd_store_iva') || '');

  // Caja y cobro: cada interruptor se guarda al tocarlo (ajustes del comercio, viajan a todas las cajas)
  const [allowNegativeStock, setAllowNegativeStock] = useState(() => {
    const saved = localStorage.getItem('allow_negative_stock');
    return saved ? saved === 'true' : true;
  });
  // Consumo de empleados: sin cargo, solo descuenta stock (ver sales.service createEmployeeConsumption)
  const [employeeConsumption, setEmployeeConsumption] = useState(() => localStorage.getItem('employee_consumption') === '1');
  // Cierre a ciegas: los empleados cuentan sin ver lo esperado ni la diferencia (ver utils/blindClose)
  const [blindClose, setBlindClose] = useState(() => localStorage.getItem('cash_blind_close') === '1');
  const [blindCloseZ, setBlindCloseZ] = useState(() => localStorage.getItem('cash_blind_close_z') === '1');
  const [lowStockAlerts, setLowStockAlerts] = useState(() => {
    const saved = localStorage.getItem('low_stock_alerts');
    return saved ? saved === 'true' : true;
  });
  const [disableChangeCalculator, setDisableChangeCalculator] = useState(() => localStorage.getItem('pos_disable_change_calculator') === 'true');
  const [openingFloat, setOpeningFloatInput] = useState(() => { const v = getOpeningFloat(); return v == null ? '' : String(v); });
  const [ventriCaja, setVentriCaja] = useState<VentriCaja>(getVentriCaja);
  const [hourlyRate, setHourlyRate] = useState(() => {
    const saved = localStorage.getItem('hourly_rate');
    return saved ? String(Number(saved) || 0) : '1500';
  });
  // Modo rendimiento: es de esta PC (no viaja a las otras)
  const [performanceMode, setPerformanceMode] = useState(() => {
    const saved = localStorage.getItem('performance_mode');
    return saved ? saved === 'true' : true;
  });

  const businessProfiles = useBusinessStore((st) => st.profiles);
  const businessFeatures = useBusinessStore((st) => st.features);
  const toggleBusinessProfile = useBusinessStore((st) => st.toggleProfile);
  const setMainBusinessProfile = useBusinessStore((st) => st.setMainProfile);
  const setBusinessFeature = useBusinessStore((st) => st.setFeature);
  // Si las funciones ya no coinciden con las de los rubros, el comercio armó su propia combinación
  const isCustomProfile = ALL_FEATURES.some((ft) => businessFeatures[ft] !== featuresOfProfiles(businessProfiles)[ft]);
  const groupedFeatures = new Set(FEATURE_GROUPS.flatMap((g) => g.features));
  const featureGroups = [
    ...FEATURE_GROUPS,
    ...(ALL_FEATURES.some((f) => !groupedFeatures.has(f)) ? [{ title: 'Otras', features: ALL_FEATURES.filter((f) => !groupedFeatures.has(f)) }] : []),
  ];

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    // ?tab=... abre una sección directo (desde "Primeros pasos", la suscripción, etc.)
    const fromHash = window.location.hash.match(/[?&]tab=([a-z]+)/)?.[1];
    return normalizeSettingsTab(initialTab) || normalizeSettingsTab(fromHash) || 'comercio';
  });

  // Posnets (de esta PC)
  const [posnets, setPosnets] = useState<{ id: string; name: string }[]>(() => {
    const stored = localStorage.getItem('posnet_configs');
    if (stored) {
      try { return JSON.parse(stored); } catch { /* lista rota: se usan las de fábrica */ }
    }
    return [
      { id: 'CLOVER', name: 'Clover' },
      { id: 'MERCADOPAGO', name: 'MercadoPago' },
    ];
  });
  const [newPosnetName, setNewPosnetName] = useState('');

  // Usuarios
  const [users, setUsers] = useState<any[]>([]);
  const [userModal, setUserModal] = useState<{ mode: 'create' } | { mode: 'edit'; user: any } | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Recargos
  const [surcharges, setSurcharges] = useState<any[]>([]);
  const [surchargeCategories, setSurchargeCategories] = useState<any[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [surchargePercentage, setSurchargePercentage] = useState(10);
  const [selectedMethods, setSelectedMethods] = useState<string[]>(['CLOVER', 'MERCADOPAGO', 'DEBT']);
  const [isSavingSurcharge, setIsSavingSurcharge] = useState(false);
  const [isLoadingSurcharges, setIsLoadingSurcharges] = useState(false);

  // Cargas virtuales
  const [virtual1Code, setVirtual1Code] = useState(() => localStorage.getItem('virtual1_code') || 'VIRTUAL1');
  const [virtual2Code, setVirtual2Code] = useState(() => localStorage.getItem('virtual2_code') || 'VIRTUAL2');
  const [virtual1Surcharge, setVirtual1Surcharge] = useState(() => Number(localStorage.getItem('virtual1_surcharge') || '0'));
  const [virtual2Surcharge, setVirtual2Surcharge] = useState(() => Number(localStorage.getItem('virtual2_surcharge') || '0'));

  // ── Posnets ──
  const savePosnets = (list: { id: string; name: string }[]) => {
    setPosnets(list);
    localStorage.setItem('posnet_configs', JSON.stringify(list));
  };

  const handleAddPosnet = () => {
    const name = newPosnetName.trim();
    if (!name) { toast.error('Escribí el nombre del posnet'); return; }
    const id = name.toUpperCase().replace(/\s+/g, '_');
    if (posnets.some((p) => p.id === id)) { toast.error('Ya hay un posnet con ese nombre'); return; }
    savePosnets([...posnets, { id, name }]);
    setNewPosnetName('');
    toastSaved('Posnet agregado');
  };

  const handleRemovePosnet = (id: string) => {
    if (posnets.length <= 1) { toast.error('Tiene que quedar al menos un posnet'); return; }
    savePosnets(posnets.filter((p) => p.id !== id));
  };

  // ── Recargos ──
  const handleSaveVirtualConfigs = () => {
    setStoreSetting('virtual1_code', virtual1Code.trim().toUpperCase());
    setStoreSetting('virtual2_code', virtual2Code.trim().toUpperCase());
    setStoreSetting('virtual1_surcharge', virtual1Surcharge.toString());
    setStoreSetting('virtual2_surcharge', virtual2Surcharge.toString());
    toastSaved('Cargas virtuales guardadas');
  };

  // Cada sección arranca desde arriba (si no, queda el scroll de la anterior)
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    if (activeTab === 'pagos') loadSurchargesData();
  }, [activeTab]);

  const loadSurchargesData = async () => {
    setIsLoadingSurcharges(true);
    try {
      const [surchargesRes, categoriesRes] = await Promise.all([api.get('/surcharges'), api.get('/categories')]);
      setSurcharges(surchargesRes.data);
      setSurchargeCategories(categoriesRes.data);
      // Elige de entrada la primera categoría que todavía no tiene recargo
      const usedIds = surchargesRes.data.map((s: any) => s.categoryId);
      const available = categoriesRes.data.filter((c: any) => !usedIds.includes(c.id));
      setSelectedCategoryId(available.length > 0 ? available[0].id : '');
    } catch {
      toast.error('No se pudieron cargar los recargos');
    } finally {
      setIsLoadingSurcharges(false);
    }
  };

  const handleSaveSurcharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategoryId) { toast.error('Elegí una categoría'); return; }
    if (selectedMethods.length === 0) { toast.error('Elegí al menos un medio de pago'); return; }
    setIsSavingSurcharge(true);
    try {
      await api.post('/surcharges', { categoryId: selectedCategoryId, percentage: surchargePercentage, paymentMethods: selectedMethods });
      toastSaved('Recargo agregado');
      loadSurchargesData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar el recargo');
    } finally {
      setIsSavingSurcharge(false);
    }
  };

  const handleDeleteSurcharge = async (id: string) => {
    undoable({
      message: 'Recargo sacado',
      hide: () => setSurcharges((list: any[]) => list.filter((s) => s.id !== id)),
      run: async () => { await api.delete(`/surcharges/${id}`); },
      onUndo: () => loadSurchargesData(),
      onError: (err) => { loadSurchargesData(); toast.error(err?.response?.data?.message || 'No se pudo sacar el recargo'); },
    });
  };

  const toggleMethod = (method: string) => {
    setSelectedMethods((prev) => (prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]));
  };

  // ── Usuarios ──
  const loadUsers = async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(data || []);
    } catch { /* sin permisos o sin conexión: queda la lista vacía */ }
  };

  const handleSubmitUser = async (v: UserFormValues) => {
    if (!userModal) return;
    const username = v.username.toUpperCase().replace(/\s+/g, '');
    if (!username) { toast.error('Poné el nombre de usuario'); return; }
    try {
      if (userModal.mode === 'create') {
        if (!v.password) { toast.error('Poné una contraseña'); return; }
        await api.post('/users', { username, password: v.password, fullName: username, role: v.role, workRole: v.role === 'ADMIN' ? '' : v.workRole });
        toast.success('Usuario creado');
      } else {
        const payload: any = { username, role: v.role, workRole: v.role === 'ADMIN' ? '' : v.workRole, isActive: v.isActive };
        if (v.password) payload.password = v.password;
        await api.patch(`/users/${userModal.user.id}`, payload);
        toast.success('Usuario actualizado');
      }
      setUserModal(null);
      loadUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar el usuario');
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (id === user?.id) { toast.error('No podés borrar el usuario con el que entraste'); return; }
    undoable({
      message: 'Usuario borrado',
      hide: () => setUsers((list: any[]) => list.filter((u) => u.id !== id)),
      run: async () => { await api.delete(`/users/${id}`); },
      onUndo: () => loadUsers(),
      onError: () => { loadUsers(); toast.error('No se pudo borrar el usuario'); },
    });
  };

  const handleChangeAdminPassword = async () => {
    if (!newAdminPassword) return;
    setIsChangingPassword(true);
    try {
      const { data: list } = await api.get('/users');
      const admin = findStoreAdmin(Array.isArray(list) ? list : []);
      if (!admin) throw { response: { data: { message: 'El comercio no tiene un administrador activo: creálo en Usuarios' } } };
      await api.patch(`/users/${admin.id}`, { password: newAdminPassword });
      resetAdminUnlock();
      toast.success(`Clave de ${admin.username} cambiada (también es la del acceso de administrador)`);
      setNewAdminPassword('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo cambiar la clave');
    } finally {
      setIsChangingPassword(false);
    }
  };

  useEffect(() => {
    // Identidad de esta PC
    let uuid = localStorage.getItem('terminal_uuid');
    if (!uuid) {
      uuid = 'term_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('terminal_uuid', uuid);
    }
    setTerminalUuid(uuid);

    api.get(`/cash/terminal-name?terminalId=${uuid}`)
      .then(({ data }) => setTerminalName(data.terminalName))
      .catch(() => setTerminalName('Terminal 1'))
      .finally(() => setIsLoading(false));

    if (isAdmin) {
      loadUsers();
      loadBackupData();
    }
  }, []);

  // ── Copias de seguridad ──
  const loadBackupData = async () => {
    try {
      const listRes = await api.get('/system/backup/list');
      setBackups(listRes.data || []);
      const settingsRes = await api.get('/system/backup/settings');
      if (settingsRes.data) {
        setAutoBackupEnabled(settingsRes.data.autoBackupEnabled);
        setSavedAutoBackup(!!settingsRes.data.autoBackupEnabled);
        setBackupTime(settingsRes.data.backupTime || '22:00');
      }
    } catch (err) {
      console.error('Error al cargar datos de backups:', err);
    }
  };

  const saveBackupSettings = async (enabled: boolean, time: string) => {
    setAutoBackupEnabled(enabled);
    setBackupTime(time);
    try {
      await api.post('/system/backup/settings', { autoBackupEnabled: enabled, backupTime: time });
      setSavedAutoBackup(enabled);
      toastSaved();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar la copia automática');
      loadBackupData();
    }
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      await api.post('/system/backup/create');
      toast.success('Copia de seguridad hecha');
      loadBackupData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo hacer la copia de seguridad');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleDownloadBackup = async (filename: string) => {
    try {
      const { data } = await api.post('/system/backup/download-ticket', { filename });
      const downloadUrl = `${api.defaults.baseURL}/system/backup/download?ticket=${data.ticket}`;
      const opened = tauriInvoke('open_browser', { url: downloadUrl });
      if (opened) opened.catch(() => window.open(downloadUrl, '_blank'));
      else window.open(downloadUrl, '_blank');
    } catch {
      toast.error('No se pudo descargar la copia');
    }
  };

  const closeRestoreModal = () => {
    setShowRestoreModal(false);
    setSelectedBackupToRestore(null);
    setUploadedFileToRestore(null);
    setRestoreConfirmWord('');
  };

  const handleRestoreBackup = async () => {
    if (restoreConfirmWord.toUpperCase() !== 'RESTAURAR') {
      toast.error('Escribí RESTAURAR para confirmar');
      return;
    }
    setIsRestoring(true);
    try {
      if (uploadedFileToRestore) {
        const formData = new FormData();
        formData.append('file', uploadedFileToRestore);
        const { data } = await api.post('/system/backup/restore/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // Un backup de cientos de MB tarda más que el límite general de 60 s en
          // subirse y restaurarse; cortar antes mostraría un error falso.
          timeout: RESTORE_TIMEOUT_MS,
        });
        if (data?.requiresRestart) return finishPendingRestore(data.message);
        toast.success('Base de datos restaurada');
      } else if (selectedBackupToRestore) {
        const { data } = await api.post('/system/backup/restore/select', { filename: selectedBackupToRestore }, { timeout: RESTORE_TIMEOUT_MS });
        if (data?.requiresRestart) return finishPendingRestore(data.message);
        toast.success('Base de datos restaurada desde la copia');
      }
      closeRestoreModal();
      toast.loading('Actualizando la sesión con la base restaurada...');
      setTimeout(() => {
        logout();
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo restaurar la copia');
    } finally {
      setIsRestoring(false);
    }
  };

  /**
   * La base estaba en uso y no se pudo reemplazar en caliente: el backup quedó
   * preparado y se aplica solo al volver a abrir Ventra.
   */
  const finishPendingRestore = (message?: string) => {
    closeRestoreModal();
    setIsRestoring(false);
    setPendingRestartMessage(message || 'El backup quedó preparado. Cerrá y volvé a abrir Ventra para completar la restauración.');
  };

  const triggerFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Limpiar el input: así elegir el mismo archivo otra vez vuelve a disparar el cambio
    e.target.value = '';
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.db') && !lowerName.endsWith('.sqlite')) {
      toast.error('Elegí un archivo .db o .sqlite');
      return;
    }
    setUploadedFileToRestore(file);
    setSelectedBackupToRestore(null);
    setShowRestoreModal(true);
  };

  // ── Qué hace el comercio con Ventra: lo que no usa sale del menú (ver businessStore) ──
  const planFeatures = usePlanStore((s) => s.features);
  const intents = useBusinessStore((s) => s.intents);
  const setIntents = useBusinessStore((s) => s.setIntents);
  const activeIntents = effectiveIntents(planFeatures, intents);
  const toggleIntent = (i: BusinessIntent) => {
    const next = activeIntents.includes(i) ? activeIntents.filter((x) => x !== i) : [...activeIntents, i];
    if (!next.length) { toast.error('Dejá al menos una'); return; }
    setIntents(next);
    toastSaved('Menú actualizado');
  };

  const handleSaveStoreData = () => {
    const name = storeName.trim();
    if (name.length < 2) { toast.error('Poné el nombre de tu comercio'); return; }
    setStoreSetting('store_name', name);
    setStoreName(name);
    setStoreSetting('store_address', storeAddress.trim());
    setStoreSetting('store_phone', storePhone.trim());
    setStoreSetting('store_cuit', storeCuit.replace(/\D/g, ''));
    setStoreSetting('store_iva', storeIva);
    toast.success('Datos del comercio guardados');
  };

  // ── Interruptores que se guardan solos ──
  const saveToggle = (setter: (v: boolean) => void, key: Parameters<typeof setStoreSetting>[0], value: string) => (v: boolean) => {
    setter(v);
    setStoreSetting(key, value === 'bool' ? String(v) : v ? '1' : '0');
    toastSaved();
  };

  const changePerformanceMode = (enabled: boolean) => {
    setPerformanceMode(enabled);
    localStorage.setItem('performance_mode', String(enabled));
    tauriInvoke('save_performance_mode', { enabled })?.catch((e) => console.error('Tauri invoke failed', e));
    window.dispatchEvent(new Event('performance-mode-changed'));
    toastSaved();
  };

  const commitOpeningFloat = () => {
    if (openingFloat.trim() === '') return;
    const n = Number(openingFloat);
    if (n === getOpeningFloat()) return;
    saveOpeningFloat(n);
    toastSaved();
  };

  const commitHourlyRate = () => {
    const value = String(Number(hourlyRate) || 0);
    if (value === localStorage.getItem('hourly_rate')) return;
    setStoreSetting('hourly_rate', value);
    toastSaved();
  };

  // ── Borrar datos (cada acción ya pidió escribir su palabra) ──
  const runDanger = async (request: () => Promise<any>, ok: string, fail: string): Promise<boolean> => {
    try {
      const res = await request();
      toast.success(res?.data?.message || ok);
      return true;
    } catch (err: any) {
      toast.error(err.response?.data?.message || fail);
      return false;
    }
  };

  // Pasos de "Terminá de configurarlo": se recalculan en cada render
  const setupSteps = buildSetupSteps({
    posnetsSaved: posnetsSaved(),
    userCount: users.length,
    autoBackupEnabled: savedAutoBackup,
    isAdmin,
  });
  const setupDone = setupSteps.filter((st) => st.done).length;
  const setupPercent = calcSetupPercent(setupSteps);
  // La píldora de la barra superior se mantiene al día (solo se ve con rol ADMIN)
  useEffect(() => {
    if (user?.role === 'ADMIN') useSetupStore.getState().setPercent(setupPercent);
  }, [setupPercent, user?.role]);

  if (isLoading) return <div className="h-full card flex items-center justify-center text-slate-600">Cargando configuración...</div>;

  const visibleSections = SETTINGS_SECTIONS.filter((sec) => !sec.adminOnly || isAdmin);
  const tab: SettingsTab = visibleSections.some((s) => s.id === activeTab) ? activeTab : 'comercio';
  const section = SETTINGS_SECTIONS.find((s) => s.id === tab)!;
  const navGroups = (['Tu negocio', 'Caja', 'Equipo', 'Sistema'] as const)
    .map((g) => ({ title: g, items: visibleSections.filter((s) => s.group === g) }))
    .filter((g) => g.items.length);
  const dangerItems = visibleSections.filter((s) => s.group === null);

  const navButton = (sec: typeof SETTINGS_SECTIONS[number]) => {
    const active = tab === sec.id;
    const Icon = sec.icon;
    return (
      <button
        key={sec.id}
        data-tour={`settings-${sec.id}`}
        onClick={() => setActiveTab(sec.id)}
        aria-current={active ? 'page' : undefined}
        className={`shrink-0 lg:w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-left text-[13.5px] whitespace-nowrap transition-colors cursor-pointer border lg:border-0 ${
          active
            ? sec.danger ? 'bg-red-50 text-red-700 font-semibold border-red-200' : 'bg-rose-50 text-rose-800 font-semibold border-rose-200'
            : sec.danger ? 'bg-white lg:bg-transparent text-red-600 font-medium border-slate-200 hover:bg-red-50/60' : 'bg-white lg:bg-transparent text-slate-700 font-medium border-slate-200 hover:bg-slate-100'
        }`}
      >
        <Icon className={`w-4 h-4 shrink-0 ${active ? (sec.danger ? 'text-red-600' : 'text-rose-600') : sec.danger ? 'text-red-500' : 'text-slate-400'}`} />
        {sec.label}
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col lg:flex-row bg-slate-50 overflow-hidden">
      {/* ── Columna izquierda: secciones agrupadas ── */}
      <aside className={`${embedded ? 'hidden' : 'flex'} w-full lg:w-[240px] shrink-0 flex-col gap-3 p-3 lg:p-4 lg:overflow-y-auto custom-scrollbar border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50`}>
        <h1 className="hidden lg:block px-3 pt-1 text-[18px] font-bold text-slate-900 tracking-tight">Configuración</h1>

        {/* Celular y pantallas angostas: una tira que se desliza */}
        <nav className="flex lg:hidden gap-1.5 overflow-x-auto scrollbar-hide">
          {visibleSections.map(navButton)}
        </nav>

        <nav className="hidden lg:flex flex-col gap-0.5">
          {navGroups.map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              <p className="px-3 pt-3 pb-1 text-[11.5px] font-semibold text-slate-400">{g.title}</p>
              {g.items.map(navButton)}
            </div>
          ))}
          {dangerItems.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col gap-0.5">{dangerItems.map(navButton)}</div>
          )}
        </nav>

        {setupDone < setupSteps.length && (
          <div className="hidden lg:block mt-auto bg-white rounded-xl border border-slate-200 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-slate-800">Terminá de configurarlo</p>
              <span className="text-[12px] font-semibold text-slate-500 tabular-nums">{setupPercent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 mt-2 overflow-hidden">
              <div className="h-full rounded-full bg-rose-600 transition-all duration-500" style={{ width: `${setupPercent}%` }} />
            </div>
            <ul className="mt-2.5 space-y-0.5">
              {setupSteps.map((step) => (
                <li key={step.label}>
                  <button
                    onClick={() => setActiveTab(normalizeSettingsTab(step.tab) || 'comercio')}
                    className="w-full flex items-center gap-2 px-1.5 py-1 -mx-1.5 rounded-md text-left hover:bg-slate-50 cursor-pointer"
                  >
                    {step.done ? <CheckCircle2 className="w-3.5 h-3.5 text-rose-600 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                    <span className={`flex-1 text-[12.5px] ${step.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{step.label}</span>
                    {!step.done && <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/* ── Contenido de la sección ── */}
      <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4 md:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="max-w-4xl"
          >
            {!embedded && (
              <SectionHeader title={section.label} description={section.description} />
            )}

            <div className="space-y-5">
              {/* ══ Comercio ══ */}
              {tab === 'comercio' && (
                <SettingsCard icon={Store} title="Datos del comercio" description="Salen en los tickets, las notas de venta, los remitos y las facturas." scope="store">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Nombre del comercio" required className="sm:col-span-2">
                      <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} maxLength={60} className={inputCls} placeholder="Distribuidora Don Pepe" />
                    </Field>
                    <Field label="Dirección">
                      <input type="text" value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} maxLength={120} className={inputCls} placeholder="Calle 9 N° 1234, Magdalena" />
                    </Field>
                    <Field label="Teléfono">
                      <input type="text" value={storePhone} onChange={(e) => setStorePhone(e.target.value)} maxLength={40} className={inputCls} placeholder="221 555 1234" />
                    </Field>
                    <Field label="CUIT" hint="Sin guiones.">
                      <input type="text" inputMode="numeric" value={storeCuit} onChange={(e) => setStoreCuit(e.target.value)} maxLength={13} className={inputCls} placeholder="20123456789" />
                    </Field>
                    <Field label="Condición frente al IVA">
                      <select value={storeIva} onChange={(e) => setStoreIva(e.target.value)} className={`${inputCls} cursor-pointer`}>
                        <option value="">Sin indicar</option>
                        <option value="RESPONSABLE_INSCRIPTO">Responsable inscripto</option>
                        <option value="MONOTRIBUTO">Monotributo</option>
                        <option value="EXENTO">Exento</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {/* El logo se guarda al elegirlo (no necesita Guardar) */}
                    <StoreLogoField />
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                    <p className="text-[12.5px] text-slate-500">Solo el nombre es obligatorio.</p>
                    <button onClick={handleSaveStoreData} className="btn-primary h-10 px-5 text-[14px] font-semibold flex items-center gap-1.5 cursor-pointer shrink-0">
                      <Check className="w-4 h-4" /> Guardar datos
                    </button>
                  </div>
                </SettingsCard>
              )}

              {/* ══ Rubros y funciones ══ */}
              {tab === 'rubros' && (
                <>
                  <SettingsCard icon={Sparkles} title="Qué hacés con Ventra" description="Lo que no usás no aparece en el menú." scope="store">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {ALL_INTENTS.map((i) => {
                        const locked = !planFeatures[INTENT_AREA[i]];
                        const on = !locked && activeIntents.includes(i);
                        return (
                          <button key={i} type="button" disabled={locked} onClick={() => toggleIntent(i)} aria-pressed={on}
                            className={`text-left p-3 rounded-xl border-2 transition-colors ${locked ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed' : on ? 'border-rose-500 bg-rose-50/60 cursor-pointer' : 'border-slate-200 hover:border-slate-300 cursor-pointer'}`}>
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[13.5px] font-semibold text-slate-800">{INTENT_LABELS[i].title}</span>
                              {on && <Check className="w-4 h-4 text-rose-600 shrink-0" />}
                              {locked && <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                            </span>
                            <span className="block text-[12px] text-slate-500 mt-0.5 leading-snug">{locked ? 'Incluido en Ventra Full' : INTENT_LABELS[i].description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </SettingsCard>

                  <SettingsCard icon={LayoutGrid} title="Rubros del comercio" description="Marcá todos los que tengas: un almacén con fiambrería suma las funciones de los dos." scope="store">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(Object.keys(PROFILE_LABELS) as BusinessProfile[]).map((profile) => {
                        const info = PROFILE_LABELS[profile];
                        const active = businessProfiles.includes(profile);
                        const main = active && businessProfiles.length > 1 && businessProfiles[0] === profile;
                        return (
                          <div
                            key={profile}
                            role="checkbox"
                            aria-checked={active}
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                            onClick={() => {
                              if (active && businessProfiles.length === 1) { toast('Tiene que quedar al menos un rubro'); return; }
                              toggleBusinessProfile(profile);
                              toastSaved(active ? `Sacaste ${info.title}` : `Sumaste ${info.title}`);
                            }}
                            className={`p-3 rounded-xl border-2 text-left flex gap-2.5 transition-colors cursor-pointer ${active ? 'border-rose-500 bg-rose-50/60' : 'border-slate-200 hover:border-slate-300'}`}
                          >
                            <span className={`mt-0.5 w-[18px] h-[18px] rounded-md border-2 flex items-center justify-center shrink-0 ${active ? 'bg-rose-600 border-rose-600 text-white' : 'border-slate-300 bg-white'}`}>
                              {active && <Check className="w-3 h-3" strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold text-slate-800">
                                {info.emoji} {info.title}
                                {main && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-600 text-white">Principal</span>}
                                {active && isCustomProfile && businessProfiles[0] === profile && (
                                  <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800">A medida</span>
                                )}
                              </span>
                              <span className="block text-[12px] text-slate-500 leading-snug mt-0.5">{info.description}</span>
                              {active && !main && businessProfiles.length > 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setMainBusinessProfile(profile); toastSaved(`${info.title} es tu rubro principal`); }}
                                  className="mt-1 text-[12px] font-semibold text-rose-700 hover:underline cursor-pointer"
                                  title="El principal define los ejemplos de la práctica, los recorridos y cómo te conoce la IA"
                                >
                                  Hacer principal
                                </button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </SettingsCard>

                  <SettingsCard icon={SlidersHorizontal} title="Funciones" description="Los rubros prenden las que suelen usar. Podés prender o apagar cada una." scope="store">
                    {featureGroups.map((g, gi) => (
                      <div key={g.title}>
                        <GroupLabel first={gi === 0}>{g.title}</GroupLabel>
                        {g.features.map((feature, fi) => (
                          <ToggleRow
                            key={feature}
                            first={fi === 0}
                            title={FEATURE_LABELS[feature].title}
                            description={FEATURE_LABELS[feature].description}
                            checked={!!businessFeatures[feature]}
                            onChange={(v) => { setBusinessFeature(feature, v); toastSaved(); }}
                          />
                        ))}
                      </div>
                    ))}
                  </SettingsCard>
                </>
              )}

              {/* ══ Tickets e impresoras ══ */}
              {tab === 'tickets' && (
                <>
                  <TicketPrinterCard />
                  <TicketLookCard />
                </>
              )}

              {/* ══ Caja y cobro ══ */}
              {tab === 'caja' && (
                <>
                  <SettingsCard icon={Wallet} title="Cómo trabaja la caja" description="Cada cambio se guarda al tocarlo." scope="store">
                    <GroupLabel first>Al cobrar</GroupLabel>
                    <ToggleRow
                      first
                      title="Calculadora de vuelto"
                      description="En efectivo, cargás con cuánto paga el cliente y te dice el vuelto."
                      checked={!disableChangeCalculator}
                      onChange={(on) => { setDisableChangeCalculator(!on); setStoreSetting('pos_disable_change_calculator', String(!on)); toastSaved(); }}
                    />
                    <ToggleRow
                      title="Vender sin stock"
                      description="Deja vender un producto aunque el sistema diga que no queda."
                      checked={allowNegativeStock}
                      onChange={saveToggle(setAllowNegativeStock, 'allow_negative_stock', 'bool')}
                    />
                    <ToggleRow
                      title="Aviso de poco stock"
                      description="Al vender, avisa si un producto quedó por debajo de su mínimo."
                      checked={lowStockAlerts}
                      onChange={saveToggle(setLowStockAlerts, 'low_stock_alerts', 'bool')}
                    />

                    <GroupLabel>Turnos y cierres</GroupLabel>
                    <SettingRow
                      first
                      stack
                      title="Fondo inicial"
                      description="El cambio que tiene que haber en el cajón al abrir. Queda siempre en el cajón: no se suma a las ventas."
                    >
                      <div className="relative w-36">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-slate-400">$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={openingFloat}
                          onChange={(e) => setOpeningFloatInput(e.target.value.replace(/[^0-9]/g, ''))}
                          onBlur={commitOpeningFloat}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className={`${inputCls} pl-7 text-right tabular-nums`}
                          placeholder="20000"
                          aria-label="Fondo inicial"
                        />
                      </div>
                    </SettingRow>
                    <ToggleRow
                      title="Cierre a ciegas"
                      description='Los empleados cuentan la plata y las tarjetas sin ver cuánto tendría que haber, ni las ventas del turno en "Estado de la caja". Vos ves todo en Control de caja.'
                      checked={blindClose}
                      onChange={saveToggle(setBlindClose, 'cash_blind_close', '01')}
                    />
                    {blindClose && (
                      <ToggleRow
                        indent
                        title="Ocultar también el reporte Z"
                        description="Los empleados cierran el día pero no ven ni imprimen el Z: lo ves e imprimís vos desde Control de caja."
                        checked={blindCloseZ}
                        onChange={saveToggle(setBlindCloseZ, 'cash_blind_close_z', '01')}
                      />
                    )}
                    <ToggleRow
                      title="Consumo propio (sin cargo)"
                      description={<>Lo que vos o tus empleados consumen del negocio: descuenta el stock y no toca la caja. Al cobrar aparece el botón &quot;Consumo propio&quot;. <a href="#/employee-consumption" className="text-rose-700 font-semibold hover:underline">Ver consumos</a></>}
                      checked={employeeConsumption}
                      onChange={saveToggle(setEmployeeConsumption, 'employee_consumption', '01')}
                    />

                    <GroupLabel>Ventri</GroupLabel>
                    <SettingRow
                      first
                      stack
                      title={<span className="flex items-center gap-2"><VentriImg cara="picara" size={28} /> Ventri en la caja</span>}
                      description="Acompaña el modo práctica, la apertura y el cierre del turno, la ayuda y las esperas. Nunca aparece al cobrar."
                    >
                      <select
                        value={ventriCaja}
                        onChange={(e) => { const v = e.target.value as VentriCaja; setVentriCaja(v); saveVentriCaja(v); toastSaved(v === 'nadie' ? 'Ventri no aparece en la caja' : 'Guardado'); }}
                        className={`${inputCls} w-52 cursor-pointer`}
                        aria-label="A quién le aparece Ventri"
                      >
                        <option value="equipo">Al dueño y encargados</option>
                        <option value="todos">A todos (también cajeros)</option>
                        <option value="nadie">A nadie</option>
                      </select>
                    </SettingRow>
                  </SettingsCard>

                  {/* Carnicería y fiambrería: cómo lee la caja las etiquetas de la balanza */}
                  {businessFeatures.scaleLabels && <ScaleSettingsCard />}
                </>
              )}

              {/* ══ Medios de pago ══ */}
              {tab === 'pagos' && (
                <>
                  <SettingsCard icon={CreditCard} title="Posnets" description="Los nombres que aparecen al cobrar con tarjeta." scope="pc">
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {posnets.map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="text-[14px] font-semibold text-slate-800">{p.name}</span>
                          <button onClick={() => handleRemovePosnet(p.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer" title="Sacar posnet" aria-label={`Sacar ${p.name}`}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <input
                        type="text"
                        value={newPosnetName}
                        onChange={(e) => setNewPosnetName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddPosnet(); }}
                        className={`${inputCls} flex-1`}
                        placeholder="Nuevo posnet, por ejemplo Clover Regalos"
                        aria-label="Nombre del posnet nuevo"
                      />
                      <button onClick={handleAddPosnet} className="btn-primary h-10 px-4 text-[14px] font-semibold flex items-center gap-1.5 cursor-pointer shrink-0">
                        <Plus className="w-4 h-4" /> Agregar
                      </button>
                    </div>
                  </SettingsCard>

                  <SettingsCard icon={Percent} title="Recargos por categoría" description="Un porcentaje que se suma solo cuando se paga con ciertos medios." scope="store">
                    <form onSubmit={handleSaveSurcharge} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-4">
                        <Field label="Categoría">
                          <select value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)} className={`${inputCls} cursor-pointer`}>
                            <option value="">Elegí una categoría</option>
                            {surchargeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </Field>
                        <Field label="Recargo (%)">
                          <input type="number" value={surchargePercentage} onChange={(e) => setSurchargePercentage(Number(e.target.value))} min="0" max="100" step="0.1" className={inputCls} placeholder="10" />
                        </Field>
                      </div>
                      <div>
                        <p className="text-[12.5px] font-semibold text-slate-600 mb-1.5">Se cobra con</p>
                        <div className="flex flex-wrap gap-2">
                          {PAYMENT_METHODS.map((m) => {
                            const on = selectedMethods.includes(m.id);
                            return (
                              <button key={m.id} type="button" onClick={() => toggleMethod(m.id)} aria-pressed={on}
                                className={`h-9 px-3.5 rounded-xl text-[13px] font-semibold border flex items-center gap-2 cursor-pointer transition-colors ${on ? 'bg-rose-50 border-rose-500 text-rose-800' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                                <span className={`w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-rose-600 border-rose-600 text-white' : 'border-slate-400'}`}>
                                  {on && <Check className="w-3 h-3" strokeWidth={3} />}
                                </span>
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <button type="submit" disabled={isSavingSurcharge} className="btn-primary h-10 px-5 text-[14px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                        {isSavingSurcharge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Agregar recargo
                      </button>
                    </form>

                    <div className="mt-5 pt-4 border-t border-slate-100">
                      <p className="text-[12px] font-semibold text-slate-500 mb-1">Recargos activos</p>
                      {isLoadingSurcharges ? (
                        <p className="py-4 text-[13px] text-slate-500">Cargando recargos...</p>
                      ) : surcharges.length === 0 ? (
                        <p className="py-4 text-[13px] text-slate-500">Todavía no hay recargos.</p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {surcharges.map((s: any) => (
                            <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[14px] font-semibold text-slate-800">{s.category?.name || 'Categoría borrada'}</div>
                                <div className="text-[12.5px] text-slate-500">
                                  <span className="font-semibold text-rose-700">+{s.percentage}%</span> con {s.paymentMethods.map(methodLabel).join(', ')}
                                </div>
                              </div>
                              <button onClick={() => handleDeleteSurcharge(s.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer" title="Sacar recargo" aria-label="Sacar recargo">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </SettingsCard>

                  <SettingsCard
                    icon={Smartphone}
                    title="Cargas virtuales"
                    description="Al escribir uno de estos códigos en la caja y tocar Enter, pide el monto de la carga."
                    scope="store"
                    action={
                      <button onClick={handleSaveVirtualConfigs} className="btn-primary h-9 px-4 text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer">
                        <Check className="w-4 h-4" /> Guardar
                      </button>
                    }
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {[
                        { n: 1, code: virtual1Code, setCode: setVirtual1Code, pct: virtual1Surcharge, setPct: setVirtual1Surcharge },
                        { n: 2, code: virtual2Code, setCode: setVirtual2Code, pct: virtual2Surcharge, setPct: setVirtual2Surcharge },
                      ].map((v) => (
                        <div key={v.n} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                          <p className="text-[13.5px] font-semibold text-slate-800">Carga virtual {v.n}</p>
                          <Field label="Código">
                            <input type="text" value={v.code} onChange={(e) => v.setCode(e.target.value)} className={`${inputCls} uppercase`} placeholder={`VIRTUAL${v.n}`} />
                          </Field>
                          <Field label="Recargo (%)">
                            <input type="number" value={v.pct} onChange={(e) => v.setPct(Number(e.target.value))} min="0" max="100" step="0.1" className={inputCls} placeholder="0" />
                          </Field>
                        </div>
                      ))}
                    </div>
                  </SettingsCard>
                </>
              )}

              {/* ══ Personal ══ */}
              {tab === 'personal' && isAdmin && (
                <>
                  <SettingsCard
                    icon={Users}
                    title="Usuarios"
                    description="Cada uno entra a la caja con el suyo, así las ventas quedan a su nombre."
                    action={
                      <button onClick={() => setUserModal({ mode: 'create' })} className="btn-primary h-9 px-4 text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer">
                        <UserPlus className="w-4 h-4" /> Sumar usuario
                      </button>
                    }
                  >
                    {users.length === 0 ? (
                      <p className="py-6 text-center text-[13px] text-slate-500">Todavía no hay usuarios.</p>
                    ) : (
                      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {users.map((u: any) => {
                          const inactive = u.isActive === false;
                          return (
                            <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                              <span className={`w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 ${inactive ? 'bg-slate-100 text-slate-400' : 'bg-rose-50 text-rose-700'}`}>
                                {String(u.username || '?').slice(0, 2)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className={`text-[14px] font-semibold truncate ${inactive ? 'text-slate-400' : 'text-slate-800'}`}>
                                  {u.username}{u.id === user?.id && <span className="ml-1.5 text-[12px] font-normal text-slate-400">(vos)</span>}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                  <span className={`text-[11.5px] font-semibold px-1.5 py-0.5 rounded-md ${u.role === 'ADMIN' ? 'bg-rose-50 text-rose-700' : u.role === 'SUPERVISOR' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {u.role === 'ADMIN' ? 'Administrador' : u.role === 'SUPERVISOR' ? 'Supervisor' : 'Cajero'}
                                  </span>
                                  {u.role !== 'ADMIN' && workRoleLabel(u.workRole) && (
                                    <span className="text-[11.5px] font-semibold px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700">{workRoleLabel(u.workRole)}</span>
                                  )}
                                  {inactive && <span className="text-[11.5px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">Inactivo</span>}
                                </div>
                              </div>
                              <button onClick={() => setUserModal({ mode: 'edit', user: u })} className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer" title="Editar" aria-label={`Editar ${u.username}`}>
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDeleteUser(u.id)} disabled={u.id === user?.id} className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Borrar" aria-label={`Borrar ${u.username}`}>
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </SettingsCard>

                  {/* Celulares de empleados: entran a la caja web sin la cuenta de Google del dueño */}
                  <StaffDevicesCard />

                  <SettingsCard
                    icon={KeyRound}
                    title={`Clave del administrador${findStoreAdmin(users) ? ` (${findStoreAdmin(users)!.username})` : ''}`}
                    description="Es también la que pide el acceso de administrador. Las de los demás se cambian en Usuarios."
                  >
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="password"
                        value={newAdminPassword}
                        onChange={(e) => setNewAdminPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleChangeAdminPassword(); }}
                        className={`${inputCls} sm:max-w-xs`}
                        placeholder="Clave nueva"
                        aria-label="Clave nueva del administrador"
                      />
                      <button onClick={handleChangeAdminPassword} disabled={isChangingPassword || !newAdminPassword} className="btn-primary h-10 px-4 text-[14px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0">
                        {isChangingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Cambiar clave
                      </button>
                    </div>
                  </SettingsCard>

                  <SettingsCard icon={Clock} title="Sueldos" scope="store">
                    <SettingRow first stack title="Valor de la hora trabajada" description='Se usa para calcular lo que se paga en los gastos de tipo "Cobrar sueldo".'>
                      <div className="relative w-36">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-slate-400">$</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={hourlyRate}
                          onChange={(e) => setHourlyRate(e.target.value.replace(/[^0-9]/g, ''))}
                          onBlur={commitHourlyRate}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className={`${inputCls} pl-7 text-right tabular-nums`}
                          placeholder="1500"
                          aria-label="Valor de la hora trabajada"
                        />
                      </div>
                    </SettingRow>
                  </SettingsCard>
                </>
              )}

              {/* ══ Esta PC ══ */}
              {tab === 'equipo' && (
                <SettingsCard icon={Laptop} title="Este equipo" scope="pc">
                  <SettingRow first title="Nombre en la red" description="Lo pone Ventra según el orden en que se conectó cada PC. Así se distinguen las cajas abiertas en cada equipo.">
                    <span className="inline-flex items-center h-9 px-3 rounded-lg bg-slate-100 text-[14px] font-semibold text-slate-800">{terminalName}</span>
                  </SettingRow>
                  <SettingRow stack title="Código del equipo" description="Por si te lo pide soporte.">
                    <span className="block max-w-[220px] truncate font-mono text-[12.5px] text-slate-600 select-all" title={terminalUuid}>{terminalUuid}</span>
                  </SettingRow>
                  <ToggleRow
                    title="Modo rendimiento"
                    description="Saca animaciones y efectos. Recomendado para PCs viejas o lentas."
                    checked={performanceMode}
                    onChange={changePerformanceMode}
                  />
                </SettingsCard>
              )}
              {tab === 'equipo' && <><FontSizeCard /><CursorSizeCard /></>}

              {/* ══ Plan y nube ══ */}
              {tab === 'suscripcion' && isAdmin && (
                <>
                  <SubscriptionPanel />
                  <CloudSyncPanel />
                </>
              )}

              {/* ══ Conexiones ══ */}
              {tab === 'integraciones' && isAdmin && (
                <>
                  <MercadoPagoCard />
                  <GoDeliveryCard />
                </>
              )}

              {/* ══ Copias de seguridad ══ */}
              {tab === 'backups' && isAdmin && (
                <>
                  <SettingsCard icon={Clock} title="Copia automática" scope="pc">
                    <ToggleRow
                      first
                      title="Hacer una copia por día"
                      description="Se guarda en esta PC. Quedan las de los últimos 15 días; las más viejas se borran solas."
                      checked={autoBackupEnabled}
                      onChange={(on) => saveBackupSettings(on, backupTime)}
                    />
                    {autoBackupEnabled && (
                      <SettingRow indent stack title="Hora de la copia" description="Conviene un horario en que la PC esté prendida.">
                        <input
                          type="time"
                          value={backupTime}
                          onChange={(e) => setBackupTime(e.target.value)}
                          onBlur={(e) => { if (e.target.value) saveBackupSettings(true, e.target.value); }}
                          className={`${inputCls} w-32 cursor-pointer`}
                          aria-label="Hora de la copia"
                        />
                      </SettingRow>
                    )}
                  </SettingsCard>

                  <SettingsCard
                    icon={Database}
                    title="Copias guardadas en esta PC"
                    action={
                      <>
                        <label className="h-9 px-3.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer">
                          <Upload className="w-4 h-4" /> Cargar copia
                          <input type="file" accept=".db,.sqlite" onChange={triggerFileRestore} className="hidden" />
                        </label>
                        <button onClick={handleCreateBackup} disabled={isCreatingBackup} className="btn-primary h-9 px-3.5 text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                          {isCreatingBackup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Hacer copia ahora
                        </button>
                      </>
                    }
                  >
                    {backups.length === 0 ? (
                      <p className="py-8 text-center text-[13px] text-slate-500 rounded-xl border border-dashed border-slate-300">Todavía no hay copias en este equipo.</p>
                    ) : (
                      <div className="max-h-[360px] overflow-y-auto custom-scrollbar rounded-xl border border-slate-200 divide-y divide-slate-100">
                        {backups.map((b, idx) => (
                          <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="text-[14px] font-semibold text-slate-800">{new Date(b.createdAt).toLocaleString('es-AR')}</div>
                              <div className="text-[12.5px] text-slate-500">
                                {b.type === 'MANUAL' ? 'Hecha a mano' : 'Automática'} · {(b.size / 1024 / 1024).toFixed(1)} MB
                              </div>
                            </div>
                            <button onClick={() => handleDownloadBackup(b.filename)} className="p-2 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer" title="Descargar" aria-label="Descargar copia">
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setSelectedBackupToRestore(b.filename); setUploadedFileToRestore(null); setShowRestoreModal(true); }}
                              className="h-8 px-3 rounded-lg border border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 flex items-center gap-1.5 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingsCard>
                </>
              )}

              {/* ══ Borrar datos ══ */}
              {tab === 'mantenimiento' && (
                <SettingsCard
                  tone="danger"
                  icon={ShieldAlert}
                  title="Zona de peligro"
                  description={<>Nada de esto se puede deshacer. Antes, hacé una copia en <button type="button" onClick={() => setActiveTab('backups')} className="font-semibold text-rose-700 hover:underline cursor-pointer">Copias de seguridad</button>.</>}
                >
                  <DangerAction
                    first
                    title="Poner el stock en 0"
                    description="Deja en 0 el stock de todos los productos. Sirve para hacer un inventario desde cero."
                    buttonLabel="Poner stock en 0"
                    word="STOCK"
                    onConfirm={() => runDanger(() => api.post('/products/bulk-reset-stock'), 'Stock de todos los productos en 0', 'No se pudo poner el stock en 0')}
                  />
                  <DangerAction
                    title="Borrar cajas y ventas"
                    description="Borra el historial de cajas, arqueos, ventas y cobros. La caja queda en limpio; los productos y clientes no se tocan."
                    buttonLabel="Borrar cajas y ventas"
                    word="CAJAS"
                    onConfirm={() => runDanger(() => api.post('/cash/reset-all'), 'Cajas y ventas borradas', 'No se pudieron borrar las cajas')}
                  />
                  <DangerAction
                    title="Vaciar el catálogo"
                    description="Saca todos los productos de la lista. Sirve para volver a cargar el catálogo desde cero."
                    buttonLabel="Vaciar catálogo"
                    word="PRODUCTOS"
                    onConfirm={() => runDanger(() => api.post('/products/bulk-delete'), 'Catálogo vaciado', 'No se pudo vaciar el catálogo')}
                  />
                  <DangerAction
                    severe
                    title="Borrar todo"
                    description={<><AlertTriangle className="inline w-3.5 h-3.5 text-red-500 -mt-0.5 mr-1" />Borra ventas, cajas, clientes, proveedores, stock, productos, categorías y usuarios. Si esta PC está vinculada a tu cuenta, se borra también en la nube, en todas tus cajas y en la web. Al volver a entrar creás un administrador nuevo.</>}
                    buttonLabel="Borrar todo"
                    word="BORRAR TODO"
                    onConfirm={async () => {
                      const ok = await runDanger(() => api.post('/system/hard-reset'), 'Se borró todo', 'No se pudo borrar todo');
                      if (ok) logout();
                      return ok;
                    }}
                  />
                </SettingsCard>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Alta y edición de usuarios */}
      <AnimatePresence>
        {userModal && (
          <UserFormModal
            key={userModal.mode === 'edit' ? userModal.user.id : 'new'}
            mode={userModal.mode}
            initial={userModal.mode === 'edit' ? { username: userModal.user.username, role: userModal.user.role, workRole: userModal.user.workRole || '', isActive: userModal.user.isActive !== false } : undefined}
            onClose={() => setUserModal(null)}
            onSubmit={handleSubmitUser}
          />
        )}
      </AnimatePresence>

      {/* Backup preparado: se aplica al reiniciar */}
      {pendingRestartMessage && (
        <div className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-amber-50 flex items-center gap-2.5">
              <RotateCcw className="w-5 h-5 text-amber-700" />
              <h2 className="text-[16px] font-bold text-slate-800">Reiniciá Ventra para terminar</h2>
            </div>
            <div className="p-6 space-y-3 text-[14px] text-slate-700">
              <p>{pendingRestartMessage}</p>
              <p className="text-[13px] text-slate-500">No se perdió nada: la base actual quedó guardada como copia de seguridad antes de reemplazarla.</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button onClick={() => setPendingRestartMessage(null)} className="h-10 px-4 rounded-xl bg-amber-600 text-white text-[14px] font-semibold hover:bg-amber-700 cursor-pointer">
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmar restauración */}
      <AnimatePresence>
        {showRestoreModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { if (!isRestoring) closeRestoreModal(); }}
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h3 className="text-[16px] font-bold text-slate-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" /> Restaurar una copia
                </h3>
                <button disabled={isRestoring} onClick={closeRestoreModal} aria-label="Cerrar" className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-900 leading-relaxed">
                  Vas a reemplazar <b>toda la base de datos</b> de este equipo por la copia: ventas, productos, stock, ajustes y cajas abiertas quedan como estaban en ese momento.
                </div>
                <p className="text-[13px] text-slate-600">
                  Copia: <span className="font-mono text-slate-800 break-all">{uploadedFileToRestore ? uploadedFileToRestore.name : selectedBackupToRestore}</span>
                </p>
                <Field label="Para confirmar, escribí RESTAURAR">
                  <input
                    type="text"
                    value={restoreConfirmWord}
                    disabled={isRestoring}
                    onChange={(e) => setRestoreConfirmWord(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRestoreBackup(); }}
                    className={inputCls}
                    placeholder="RESTAURAR"
                    autoFocus
                  />
                </Field>
              </div>
              <div className="flex gap-2 px-6 py-4 border-t border-slate-100">
                <button
                  onClick={handleRestoreBackup}
                  disabled={isRestoring || restoreConfirmWord.toUpperCase() !== 'RESTAURAR'}
                  className="flex-1 h-11 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-[14px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} {isRestoring ? 'Restaurando…' : 'Reemplazar base de datos'}
                </button>
                <button type="button" disabled={isRestoring} onClick={closeRestoreModal} className="h-11 px-5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-[14px] font-semibold cursor-pointer">
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
