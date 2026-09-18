import { useState, useEffect } from 'react';
import { useAutoTour } from '../common/tour/GuidedTour';
import { buildSetupSteps, setupPercent as calcSetupPercent, posnetsSaved, useSetupStore } from '../../utils/setupProgress';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { 
   Settings, 
   Laptop, 
   Save, 
   RotateCcw, 
   AlertTriangle, 
   ShieldAlert, 
   Info, 
   CheckCircle2, 
   Trash2, 
   Database, 
   Lock,
   Sliders,
   Users,
   UserPlus,
   Plus,
   X,
   Key,
   Edit,
   Download,
   Calendar,
   Clock,
   Check,
   Upload,
   Calculator,
   AlertCircle,
   Link2,
   ChevronRight,
   Circle
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { usePOSStore } from '../../stores/posStore';

const RESTORE_TIMEOUT_MS = 15 * 60 * 1000;

export default function SettingsScreen() {
  const { user, resetAdminUnlock, logout } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN' || localStorage.getItem('admin_unlocked') === 'true' || sessionStorage.getItem('admin_unlocked') === 'true';

  // State
  const [terminalUuid, setTerminalUuid] = useState('');
  const [terminalName, setTerminalName] = useState('Terminal 1');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  useAutoTour('settings', !isLoading);

  // Backup states
  const [backups, setBackups] = useState<any[]>([]);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [backupTime, setBackupTime] = useState('22:00');
  const [isSavingBackupSettings, setIsSavingBackupSettings] = useState(false);
  const [savedAutoBackup, setSavedAutoBackup] = useState(false);

  // Restoration states
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingRestartMessage, setPendingRestartMessage] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedBackupToRestore, setSelectedBackupToRestore] = useState<string | null>(null);
  const [restoreConfirmWord, setRestoreConfirmWord] = useState('');
  const [uploadedFileToRestore, setUploadedFileToRestore] = useState<File | null>(null);

  // System parameters
  const [allowNegativeStock, setAllowNegativeStock] = useState(() => {
    const saved = localStorage.getItem('allow_negative_stock');
    return saved ? saved === 'true' : true;
  });
  const [lowStockAlerts, setLowStockAlerts] = useState(() => {
    const saved = localStorage.getItem('low_stock_alerts');
    return saved ? saved === 'true' : true;
  });
  const [hourlyRate, setHourlyRate] = useState(() => {
    const saved = localStorage.getItem('hourly_rate');
    return saved ? Number(saved) : 1500;
  });
  const [performanceMode, setPerformanceMode] = useState(() => {
    const saved = localStorage.getItem('performance_mode');
    return saved ? saved === 'true' : true;
  });
  const [disableChangeCalculator, setDisableChangeCalculator] = useState(() => {
    const saved = localStorage.getItem('pos_disable_change_calculator');
    return saved ? saved === 'true' : false;
  });
  const [businessType, setBusinessType] = useState<'KIOSKO' | 'FERRETERIA'>(() => {
    const saved = localStorage.getItem('business_type');
    return (saved as any) || 'KIOSKO';
  });

  // Integraciones: vínculo de cuenta de Google con GoDelivery
  const [localGoogleUser, setLocalGoogleUser] = useState<any>(() => {
    const saved = localStorage.getItem('google_authenticated_user');
    return saved ? JSON.parse(saved) : null;
  });

  const handleDisconnectGoogle = () => {
    if (confirm('¿Estás seguro de desvincular la cuenta de Google? Los productos ya no se sincronizarán con GoDelivery.')) {
      localStorage.removeItem('google_authenticated_user');
      setLocalGoogleUser(null);
      toast.success('Cuenta de Google desvinculada');
    }
  };

  const handleConnectGoogle = () => {
    const activePort = sessionStorage.getItem('active_backend_port') || '3001';
    const authUrl = `http://localhost:${activePort}/api/auth/google/login-page`;

    // Open external browser using Rust command to ensure compatibility
    if ((window as any).__TAURI__) {
      const invokeFn = (window as any).__TAURI__.core?.invoke || (window as any).__TAURI__.invoke;
      if (invokeFn) {
        invokeFn('open_browser', { url: authUrl }).catch(() => window.open(authUrl, '_blank'));
      } else {
        window.open(authUrl, '_blank');
      }
    } else {
      window.open(authUrl, '_blank');
    }
    toast('Iniciando sesión segura en tu navegador...');

    const pollInterval = setInterval(async () => {
      try {
        const { data } = await api.get('/auth/google-link-status');
        if (data.linked && data.user) {
          clearInterval(pollInterval);
          localStorage.setItem('google_authenticated_user', JSON.stringify(data.user));
          setLocalGoogleUser(data.user);
          toast.success('¡Cuenta de Google vinculada con éxito!');
        }
      } catch (e) {
        // Ignore transient polling errors
      }
    }, 1000);

    setTimeout(() => clearInterval(pollInterval), 300000);
  };

  const [activeTab, setActiveTab] = useState<'general' | 'posnets' | 'recargos' | 'personal' | 'backups' | 'integraciones' | 'mantenimiento'>('general');

  // Posnet Config States
  const [posnets, setPosnets] = useState<{ id: string; name: string }[]>(() => {
    const stored = localStorage.getItem('posnet_configs');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {}
    }
    return [
      { id: 'CLOVER', name: 'Clover' },
      { id: 'MERCADOPAGO', name: 'MercadoPago' }
    ];
  });
  const [newPosnetName, setNewPosnetName] = useState('');

  const handleAddPosnet = () => {
    if (!newPosnetName.trim()) {
      toast.error('El nombre del posnet no puede estar vacío');
      return;
    }
    const id = newPosnetName.trim().toUpperCase().replace(/\s+/g, '_');
    if (posnets.some(p => p.id === id)) {
      toast.error('Ya existe un posnet con un identificador similar');
      return;
    }
    const updated = [...posnets, { id, name: newPosnetName.trim() }];
    setPosnets(updated);
    localStorage.setItem('posnet_configs', JSON.stringify(updated));
    setNewPosnetName('');
  };

  const handleRemovePosnet = (id: string) => {
    if (posnets.length <= 1) {
      toast.error('Debes tener al menos un método de pago posnet configurado');
      return;
    }
    const updated = posnets.filter(p => p.id !== id);
    setPosnets(updated);
    localStorage.setItem('posnet_configs', JSON.stringify(updated));
  };

  // Reset states
  const [showResetCajas, setShowResetCajas] = useState(false);
  const [cajasConfirmWord, setCajasConfirmWord] = useState('');
  const [isResettingCajas, setIsResettingCajas] = useState(false);

  const [showResetStock, setShowResetStock] = useState(false);
  const [stockConfirmWord, setStockConfirmWord] = useState('');
  const [isResettingStock, setIsResettingStock] = useState(false);

  const [showResetCatalog, setShowResetCatalog] = useState(false);
  const [catalogConfirmWord, setCatalogConfirmWord] = useState('');
  const [isResettingCatalog, setIsResettingCatalog] = useState(false);

  const [showHardReset, setShowHardReset] = useState(false);
  const [hardResetConfirmWord, setHardResetConfirmWord] = useState('');
  const [isHardResetting, setIsHardResetting] = useState(false);

  // User Management States
  const [users, setUsers] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState('CASHIER');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  // User Edit States
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState('CASHIER');
  const [editIsActive, setEditIsActive] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Surcharge states
  const [surcharges, setSurcharges] = useState<any[]>([]);
  const [surchargeCategories, setSurchargeCategories] = useState<any[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [surchargePercentage, setSurchargePercentage] = useState(10);
  const [selectedMethods, setSelectedMethods] = useState<string[]>(['CLOVER', 'MERCADOPAGO', 'DEBT']); // default non-cash
  const [isSavingSurcharge, setIsSavingSurcharge] = useState(false);
  const [isLoadingSurcharges, setIsLoadingSurcharges] = useState(false);

  // Virtual Load Surcharges and Codes
  const [virtual1Code, setVirtual1Code] = useState(() => localStorage.getItem('virtual1_code') || 'VIRTUAL1');
  const [virtual2Code, setVirtual2Code] = useState(() => localStorage.getItem('virtual2_code') || 'VIRTUAL2');
  const [virtual1Surcharge, setVirtual1Surcharge] = useState(() => Number(localStorage.getItem('virtual1_surcharge') || '0'));
  const [virtual2Surcharge, setVirtual2Surcharge] = useState(() => Number(localStorage.getItem('virtual2_surcharge') || '0'));

  const handleSaveVirtualConfigs = () => {
    localStorage.setItem('virtual1_code', virtual1Code.trim().toUpperCase());
    localStorage.setItem('virtual2_code', virtual2Code.trim().toUpperCase());
    localStorage.setItem('virtual1_surcharge', virtual1Surcharge.toString());
    localStorage.setItem('virtual2_surcharge', virtual2Surcharge.toString());
    toast.success('✅ Configuración de Cargas Virtuales guardada con éxito');
  };

  useEffect(() => {
    if (activeTab === 'recargos') {
      loadSurchargesData();
    }
  }, [activeTab]);

  const loadSurchargesData = async () => {
    setIsLoadingSurcharges(true);
    try {
      const [surchargesRes, categoriesRes] = await Promise.all([
        api.get('/surcharges'),
        api.get('/categories')
      ]);
      setSurcharges(surchargesRes.data);
      setSurchargeCategories(categoriesRes.data);
      
      // Auto select first category not already surcharged
      const usedIds = surchargesRes.data.map((s: any) => s.categoryId);
      const available = categoriesRes.data.filter((c: any) => !usedIds.includes(c.id));
      if (available.length > 0) {
        setSelectedCategoryId(available[0].id);
      } else {
        setSelectedCategoryId('');
      }
    } catch {
      toast.error('Error al cargar datos de recargos');
    } finally {
      setIsLoadingSurcharges(false);
    }
  };

  const handleSaveSurcharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCategoryId) {
      toast.error('Selecciona una categoría');
      return;
    }
    if (selectedMethods.length === 0) {
      toast.error('Selecciona al menos un método de pago para aplicar el recargo');
      return;
    }
    setIsSavingSurcharge(true);
    try {
      await api.post('/surcharges', {
        categoryId: selectedCategoryId,
        percentage: surchargePercentage,
        paymentMethods: selectedMethods
      });
      toast.success('✅ Recargo configurado correctamente');
      loadSurchargesData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al guardar recargo');
    } finally {
      setIsSavingSurcharge(false);
    }
  };

  const handleDeleteSurcharge = async (id: string) => {
    if (!window.confirm('¿Estás seguro de eliminar este recargo?')) return;
    try {
      await api.delete(`/surcharges/${id}`);
      loadSurchargesData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al eliminar recargo');
    }
  };

  const toggleMethod = (method: string) => {
    setSelectedMethods(prev => 
      prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
    );
  };

  const handleOpenEditModal = (u: any) => {
    setEditingUserId(u.id);
    setEditUsername(u.username);
    setEditPassword('');
    setEditRole(u.role);
    setEditIsActive(u.isActive !== false);
    setShowEditModal(true);
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUsername) {
      toast.error('Nombre de usuario obligatorio');
      return;
    }
    setIsSavingEdit(true);
    try {
      const payload: any = {
        username: editUsername.toUpperCase().replace(/\s+/g, ''),
        role: editRole,
        isActive: editIsActive
      };
      if (editPassword) {
        payload.password = editPassword;
      }
      await api.patch(`/users/${editingUserId}`, payload);
      toast.success('✅ Cajero / Usuario actualizado con éxito');
      setShowEditModal(false);
      loadUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al actualizar usuario');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const loadUsers = async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(data || []);
    } catch {}
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) {
      toast.error('Completá todos los campos');
      return;
    }
    setIsCreatingUser(true);
    try {
      await api.post('/users', { username: newUsername, password: newPassword, fullName: newUsername, role: newRole });
      toast.success('✅ Cajero/Usuario creado correctamente');
      setNewUsername('');
      setNewPassword('');
      setNewFullName('');
      setNewRole('CASHIER');
      setShowCreateModal(false);
      loadUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al crear usuario');
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (id === user?.id) {
      toast.error('No podés eliminar tu propio usuario activo');
      return;
    }
    if (!confirm('¿Estás seguro de que deseas eliminar este usuario/cajero?')) return;
    try {
      await api.delete(`/users/${id}`);
      loadUsers();
    } catch {
      toast.error('Error al eliminar usuario');
    }
  };

  useEffect(() => {
    // 1. Resolve local PC terminal identity
    let uuid = localStorage.getItem('terminal_uuid');
    if (!uuid) {
      uuid = 'term_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('terminal_uuid', uuid);
    }
    setTerminalUuid(uuid);

    api.get(`/cash/terminal-name?terminalId=${uuid}`)
      .then(({ data }) => {
        setTerminalName(data.terminalName);
      })
      .catch(() => {
        setTerminalName('Terminal 1');
      })
      .finally(() => {
        setIsLoading(false);
      });

    if (isAdmin) {
      loadUsers();
      loadBackupData();
    }
  }, []);

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

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      await api.post('/system/backup/create');
      toast.success('✅ ¡Copia de seguridad local generada con éxito!');
      loadBackupData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al generar la copia de seguridad');
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleSaveBackupSettings = async () => {
    setIsSavingBackupSettings(true);
    try {
      await api.post('/system/backup/settings', {
        autoBackupEnabled,
        backupTime,
      });
      toast.success('💾 Programación de backups guardada');
      loadBackupData();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al guardar la configuración');
    } finally {
      setIsSavingBackupSettings(false);
    }
  };

  const handleDownloadBackup = async (filename: string) => {
    try {
      const downloadUrl = `${api.defaults.baseURL}/system/backup/download?filename=${filename}`;
      if ((window as any).__TAURI__) {
        const invokeFn = (window as any).__TAURI__.core?.invoke || (window as any).__TAURI__.invoke;
        invokeFn('open_browser', { url: downloadUrl }).catch(() => window.open(downloadUrl, '_blank'));
      } else {
        window.open(downloadUrl, '_blank');
      }
    } catch (err) {
      toast.error('Error al descargar el archivo de backup');
    }
  };

  const handleRestoreBackup = async () => {
    if (restoreConfirmWord.toUpperCase() !== 'RESTAURAR') {
      toast.error('Palabra clave incorrecta. Escribí "RESTAURAR" en mayúsculas.');
      return;
    }
    setIsRestoring(true);
    try {
      if (uploadedFileToRestore) {
        const formData = new FormData();
        formData.append('file', uploadedFileToRestore);
        const { data } = await api.post('/system/backup/restore/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          // Un backup de cientos de MB tarda más que el límite general de 60 s en
          // subirse y restaurarse; cortar antes mostraría un error falso.
          timeout: RESTORE_TIMEOUT_MS,
        });
        if (data?.requiresRestart) return finishPendingRestore(data.message);
        toast.success('🎉 Base de datos cargada y restaurada con éxito!');
      } else if (selectedBackupToRestore) {
        const { data } = await api.post('/system/backup/restore/select', {
          filename: selectedBackupToRestore,
        }, { timeout: RESTORE_TIMEOUT_MS });
        if (data?.requiresRestart) return finishPendingRestore(data.message);
        toast.success('🎉 Base de datos restaurada con éxito desde copia local!');
      }
      
      setShowRestoreModal(false);
      setSelectedBackupToRestore(null);
      setUploadedFileToRestore(null);
      setRestoreConfirmWord('');

      toast.loading('Actualizando sesión con la base de datos importada...');
      setTimeout(() => {
        logout();
        window.location.reload();
      }, 1200);
      
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al restaurar la copia de seguridad');
    } finally {
      setIsRestoring(false);
    }
  };

  /**
   * La base estaba en uso y no se pudo reemplazar en caliente: el backup quedó
   * preparado y se aplica solo al volver a abrir Ventra.
   */
  const finishPendingRestore = (message?: string) => {
    setShowRestoreModal(false);
    setSelectedBackupToRestore(null);
    setUploadedFileToRestore(null);
    setRestoreConfirmWord('');
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
      toast.error('Por favor, selecciona un archivo .db o .sqlite');
      return;
    }

    setUploadedFileToRestore(file);
    setSelectedBackupToRestore(null);
    setShowRestoreModal(true);
  };

  const handleSaveTerminalName = async () => {
    setIsSavingName(true);
    try {
      // Modify index in terminals.json by modifying the array
      const filePath = 'prisma/terminals.json';
      
      // Call update endpoint or simulate backend save by calling the endpoint again to register/cache it
      await api.get(`/cash/terminal-name?terminalId=${terminalUuid}`);
      
      // Store custom terminal name locally in localStorage for backup
      localStorage.setItem(`terminal_custom_name_${terminalUuid}`, terminalName);
      
      toast.success('✅ Identidad del dispositivo actualizada');
    } catch {
      toast.error('Error al actualizar la terminal');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleSaveSystemConfig = () => {
    localStorage.setItem('allow_negative_stock', String(allowNegativeStock));
    localStorage.setItem('low_stock_alerts', String(lowStockAlerts));
    localStorage.setItem('hourly_rate', String(hourlyRate));
    localStorage.setItem('performance_mode', String(performanceMode));
    localStorage.setItem('pos_disable_change_calculator', String(disableChangeCalculator));
    if ((window as any).__TAURI__) {
      try {
        const invokeFn = (window as any).__TAURI__.core?.invoke || (window as any).__TAURI__.invoke;
        if (invokeFn) {
          invokeFn('save_performance_mode', { enabled: performanceMode });
        }
      } catch (e) {
        console.error("Tauri invoke failed", e);
      }
    }
    if (performanceMode) {
      document.body.setAttribute('data-performance-mode', 'true');
    } else {
      document.body.removeAttribute('data-performance-mode');
    }
    usePOSStore.getState().setIsWarmed(false); // Invalidate cache warming status to reload database
    window.dispatchEvent(new Event('performance-mode-changed'));
    toast.success('✅ Parámetros guardados. Recargando base de datos...');
  }

  const handleChangeAdminPassword = async () => {
    if (!newAdminPassword) return;
    setIsChangingPassword(true);
    try {
      await api.patch(`/users/${user?.id}`, { password: newAdminPassword });
      localStorage.setItem('admin_password', newAdminPassword);
      resetAdminUnlock();
      toast.success('✅ Contraseña ADMIN actualizada');
      setNewAdminPassword('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al cambiar contraseña');
    } finally {
      setIsChangingPassword(false);
    }
  };;

  // Reset Sales and Registers
  const handleResetCajas = async () => {
    if (cajasConfirmWord.toUpperCase() !== 'CAJAS') {
      toast.error('Palabra clave incorrecta');
      return;
    }
    setIsResettingCajas(true);
    try {
      await api.post('/cash/reset-all');
      toast.success('💥 Historial de cajas y ventas eliminado correctamente');
      setShowResetCajas(false);
      setCajasConfirmWord('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al resetear cajas');
    } finally {
      setIsResettingCajas(false);
    }
  };

  // Reset Product Stocks to 0
  const handleResetStock = async () => {
    if (stockConfirmWord.toUpperCase() !== 'STOCK') {
      toast.error('Palabra clave incorrecta');
      return;
    }
    setIsResettingStock(true);
    try {
      await api.post('/products/bulk-reset-stock');
      toast.success('📦 Stock de todos los productos restablecido a 0');
      setShowResetStock(false);
      setStockConfirmWord('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al resetear stock');
    } finally {
      setIsResettingStock(false);
    }
  };

  // Clear/Empty Product Catalog
  const handleResetCatalog = async () => {
    if (catalogConfirmWord.toUpperCase() !== 'PRODUCTOS') {
      toast.error('Palabra clave incorrecta');
      return;
    }
    setIsResettingCatalog(true);
    try {
      await api.post('/products/bulk-delete');
      toast.success('🗑️ Catálogo de productos vaciado por completo');
      setShowResetCatalog(false);
      setCatalogConfirmWord('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al vaciar catálogo');
    } finally {
      setIsResettingCatalog(false);
    }
  };

  // Database Hard Reset
  const handleHardReset = async () => {
    if (hardResetConfirmWord.toUpperCase() !== 'BORRAR TODO') {
      toast.error('Palabra clave incorrecta');
      return;
    }
    setIsHardResetting(true);
    try {
      await api.post('/system/hard-reset');
      toast.success('💥 Base de datos restablecida por completo.');
      setShowHardReset(false);
      setHardResetConfirmWord('');
      logout();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al restablecer base de datos');
    } finally {
      setIsHardResetting(false);
    }
  };

  const settingsSections: { id: typeof activeTab; label: string; description: string; icon: any; adminOnly?: boolean; danger?: boolean }[] = [
    { id: 'general', label: 'General y POS', description: 'Rubro, terminal, caja y comportamiento del punto de venta', icon: Laptop },
    { id: 'posnets', label: 'Métodos de pago', description: 'Posnets y medios de cobro que aceptás', icon: Sliders },
    { id: 'recargos', label: 'Recargos', description: 'Recargos por medio de pago y categoría', icon: Calculator },
    { id: 'personal', label: 'Personal y cajeros', description: 'Usuarios, roles y contraseñas del equipo', icon: Users, adminOnly: true },
    { id: 'backups', label: 'Backup y seguridad', description: 'Copias de seguridad automáticas y restauración', icon: Database, adminOnly: true },
    { id: 'integraciones', label: 'Integraciones', description: 'Cuentas y servicios conectados', icon: Link2, adminOnly: true },
    { id: 'mantenimiento', label: 'Mantenimiento', description: 'Reinicios y limpieza de datos', icon: ShieldAlert, danger: true },
  ];

  // Re-evaluated every render; saving posnets re-renders, so this stays current.
  const setupSteps = buildSetupSteps({
    posnetsSaved: posnetsSaved(),
    userCount: users.length,
    autoBackupEnabled: savedAutoBackup,
    isAdmin,
  });
  const setupDone = setupSteps.filter((st) => st.done).length;
  const setupPercent = calcSetupPercent(setupSteps);
  // Keep the top-bar pill in sync live (it only shows for role ADMIN).
  useEffect(() => {
    if (user?.role === 'ADMIN') useSetupStore.getState().setPercent(setupPercent);
  }, [setupPercent, user?.role]);

  if (isLoading) return <div className="h-full card flex items-center justify-center text-slate-600">Cargando configuración...</div>;

  return (
    <div className="h-full flex flex-col lg:flex-row bg-slate-50 overflow-hidden">
      {/* ── Columna izquierda: encabezado + secciones ── */}
      <aside className="w-full lg:w-[250px] xl:w-[280px] shrink-0 flex flex-col gap-4 p-4 lg:p-5 lg:overflow-y-auto custom-scrollbar border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50">
        <div className="px-1">
          <p className="eyebrow">Configuración</p>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight mt-1">Centro de ajustes</h1>
          <p className="text-[13px] text-slate-500 mt-1 leading-snug">Adaptá el sistema a la forma de trabajar de tu negocio.</p>
        </div>

        <nav className="flex lg:flex-col gap-1.5 overflow-x-auto scrollbar-hide lg:overflow-visible lg:bg-white lg:p-1.5 rounded-2xl lg:border border-slate-200 lg:shadow-2xs">
          {settingsSections.filter((sec) => !sec.adminOnly || isAdmin).map((sec) => {
            const active = activeTab === sec.id;
            const Icon = sec.icon;
            return (
              <button
                key={sec.id}
                data-tour={`settings-${sec.id}`}
                onClick={() => setActiveTab(sec.id)}
                className={`group relative shrink-0 lg:w-full flex items-center gap-3 px-3 py-2.5 lg:py-3 rounded-xl text-left transition-all cursor-pointer border ${
                  active
                    ? sec.danger ? 'bg-red-50 border-red-200' : 'bg-rose-50 border-rose-200'
                    : 'bg-white lg:bg-transparent border-slate-200 lg:border-transparent hover:bg-slate-50'
                }`}
              >
                {active && <span className={`hidden lg:block absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${sec.danger ? 'bg-red-500' : 'bg-rose-600'}`} />}
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  active
                    ? sec.danger ? 'bg-red-100 text-red-600' : 'bg-white text-rose-600 shadow-2xs'
                    : sec.danger ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-500 group-hover:text-slate-700'
                }`}>
                  <Icon className="w-4.5 h-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] font-semibold whitespace-nowrap ${active ? (sec.danger ? 'text-red-700' : 'text-rose-800') : sec.danger ? 'text-red-600' : 'text-slate-800'}`}>{sec.label}</span>
                  <span className="hidden lg:block text-[11.5px] text-slate-500 leading-snug mt-0.5">{sec.description}</span>
                </span>
                <ChevronRight className={`hidden lg:block w-4 h-4 shrink-0 transition-transform ${active ? 'text-rose-500 translate-x-0.5' : 'text-slate-300 group-hover:text-slate-400'}`} />
              </button>
            );
          })}
        </nav>

        <p className="hidden lg:block text-[11.5px] text-slate-400 leading-relaxed px-1">
          Los ajustes de este equipo se guardan al instante. Los que afectan a toda la red se confirman con <span className="font-semibold text-slate-500">Guardar</span>.
        </p>
      </aside>

      <div className="flex-1 min-w-0 flex overflow-hidden">
        {/* Content Pane */}
        <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4 md:p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'general' && (
              <motion.div
                key="general"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 max-w-4xl"
              >
                {/* PC Identity */}
                <div className="card p-6 space-y-4">
                  <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
                    <Laptop className="w-4.5 h-4.5 text-rose-500" /> Identidad de este Dispositivo
                  </h3>
                  
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-400 text-xs font-semibold text-slate-700 flex flex-col gap-1 shadow-inner">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Identificador Único (PC UUID)</span>
                    <span className="font-mono text-slate-750 select-all truncate">{terminalUuid}</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Nombre del Terminal en Red</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={terminalName} 
                        onChange={(e) => setTerminalName(e.target.value)} 
                        className="flex-1 bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                        placeholder="Ej: Terminal 1"
                      />
                      <button
                        onClick={handleSaveTerminalName}
                        disabled={isSavingName}
                        className="btn-primary text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isSavingName ? '...' : <Save className="w-4 h-4" />} Guardar
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-405 leading-relaxed">Este nombre identifica la PC actual y previene que múltiples usuarios operen cajas independientes en el mismo equipo físico.</p>
                  </div>
                </div>

                {/* System Parameters */}
                <div className="card p-6 space-y-4">
                  <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
                    <Sliders className="w-4.5 h-4.5 text-emerald-500" /> Parámetros del Sistema (POS & Caja)
                  </h3>

                  <div className="space-y-4">
                    {/* Rubro del Negocio */}
                    <div className="space-y-2 pb-2">
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Rubro / Tipo de Comercio</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setBusinessType('KIOSKO');
                            localStorage.setItem('business_type', 'KIOSKO');
                            toast.success('Modo Kiosco activado (interfaz simplificada)');
                          }}
                          className={`p-3.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                            businessType === 'KIOSKO'
                              ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100 ring-2 ring-rose-500/20'
                              : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span className="text-xs font-bold flex items-center gap-1.5">
                            🍬 Kiosco / Almacén (Predeterminado)
                          </span>
                          <span className="text-[9.5px] text-slate-500 dark:text-slate-400 leading-tight">
                            Interfaz simple y limpia por unidades o packs. Oculta acopios, presupuestos y sustitutos para no saturar el mostrador.
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setBusinessType('FERRETERIA');
                            localStorage.setItem('business_type', 'FERRETERIA');
                            toast.success('Modo Ferretería activado (Acopios, Presupuestos, Sustitutos y Fraccionados)');
                          }}
                          className={`p-3.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                            businessType === 'FERRETERIA'
                              ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                              : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span className="text-xs font-bold flex items-center gap-1.5">
                            🔧 Ferretería / Corralón / Multirubro
                          </span>
                          <span className="text-[9.5px] text-slate-500 dark:text-slate-400 leading-tight">
                            Habilita Acopio y Remitos parciales, Presupuestos / Cotizaciones, Productos Sustitutos, Tarifas de Gremio y unidades de medida (Metros, Kilos, Litros).
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className="h-px bg-slate-100" />


                    <div className="space-y-3.5">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div className="max-w-[80%]">
                          <span className="text-xs font-bold text-slate-700 block">Ventas con Stock Negativo</span>
                          <span className="text-[9.5px] text-slate-600 block font-medium leading-tight">Permite facturar productos aunque no tengan stock disponible en el sistema.</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={allowNegativeStock} 
                          onChange={(e) => setAllowNegativeStock(e.target.checked)} 
                          className="rounded-md border-slate-400 text-emerald-600 focus:ring-emerald-500 h-4.5 w-4.5 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between cursor-pointer group">
                        <div className="max-w-[80%]">
                          <span className="text-xs font-bold text-slate-700 block">Alertas de Bajo Stock</span>
                          <span className="text-[9.5px] text-slate-600 block font-medium leading-tight">Activa notificaciones flotantes en el POS al facturar productos bajo el mínimo configurado.</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={lowStockAlerts} 
                          onChange={(e) => setLowStockAlerts(e.target.checked)} 
                          className="rounded-md border-slate-400 text-emerald-600 focus:ring-emerald-500 h-4.5 w-4.5 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between cursor-pointer group">
                        <div className="max-w-[80%]">
                          <span className="text-xs font-bold text-slate-700 block">Calculadora de Vuelto en Efectivo</span>
                          <span className="text-[9.5px] text-slate-600 block font-medium leading-tight">Habilita la opción de introducir el monto recibido del cliente para calcular el vuelto automáticamente.</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={!disableChangeCalculator} 
                          onChange={(e) => setDisableChangeCalculator(!e.target.checked)} 
                          className="rounded-md border-slate-400 text-emerald-600 focus:ring-emerald-500 h-4.5 w-4.5 cursor-pointer"
                        />
                      </label>

                      <label className="flex items-center justify-between cursor-pointer group pt-2 border-t border-slate-300/50">
                        <div className="max-w-[80%]">
                          <span className="text-xs font-bold text-rose-600 block flex items-center gap-1.5">⚡ Modo Rendimiento (Bajo Consumo)</span>
                          <span className="text-[9.5px] text-slate-600 block font-medium leading-tight">Desactiva transiciones, desenfoques de modales y efectos visuales pesados. Recomendado para PCs antiguas.</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={performanceMode} 
                          onChange={(e) => setPerformanceMode(e.target.checked)} 
                          className="rounded-md border-slate-400 text-rose-600 focus:ring-rose-500 h-4.5 w-4.5 cursor-pointer"
                        />
                      </label>
                    </div>

                    <div className="h-px bg-slate-100" />

                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Valor de la Hora Trabajada ($)</label>
                      <input 
                        type="number" 
                        value={hourlyRate} 
                        onChange={(e) => setHourlyRate(Number(e.target.value))} 
                        className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner" 
                        placeholder="1500"
                      />
                      <p className="text-[9px] text-slate-405">Se usará para calcular el monto a liquidar en los egresos de tipo "Cobrar Sueldo".</p>
                    </div>
                  </div>

                  <button
                    onClick={handleSaveSystemConfig}
                    className="btn-success w-full text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer mt-4"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Guardar Parámetros
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'posnets' && (
              <motion.div
                key="posnets"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl"
              >
                <div className="card p-6 space-y-4">
                  <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
                    <Sliders className="w-4.5 h-4.5 text-rose-500" /> Posnets (Métodos de Pago POS)
                  </h3>
                  
                  <p className="text-[10px] text-slate-600">
                    Administrá los nombres y terminales de Posnet disponibles en la pantalla de cobro del Punto de Venta. Se guardarán para esta sucursal.
                  </p>

                  <div className="space-y-2 max-h-[350px] overflow-y-auto custom-scrollbar pr-1">
                    {posnets.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-400">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-705">{p.name}</span>
                          <span className="text-[9px] font-mono text-slate-600">ID: {p.id}</span>
                        </div>
                        <button 
                          onClick={() => handleRemovePosnet(p.id)}
                          className="p-1.5 hover:bg-red-50 text-slate-600 hover:text-red-650 rounded-lg transition-all cursor-pointer"
                          title="Eliminar posnet"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="h-px bg-slate-100 my-2" />

                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Nuevo Posnet (Nombre)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newPosnetName} 
                        onChange={(e) => setNewPosnetName(e.target.value)} 
                        className="flex-1 bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-750 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                        placeholder="Ej: Clover Regalos"
                      />
                      <button
                        onClick={handleAddPosnet}
                        className="btn-primary text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer shrink-0"
                      >
                        <Plus className="w-4 h-4" /> Agregar
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'recargos' && (
              <motion.div
                key="recargos"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 max-w-4xl"
              >
                {/* Form to add surcharge */}
                <div className="card p-6 space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-300">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <Calculator className="w-4.5 h-4.5 text-rose-500" /> Configuración de Recargos
                    </h3>
                  </div>

                  <form onSubmit={handleSaveSurcharge} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Categoria */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Categoría</label>
                        <select
                          value={selectedCategoryId}
                          onChange={(e) => setSelectedCategoryId(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-750 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner"
                        >
                          <option value="">Seleccione una categoría</option>
                          {surchargeCategories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Porcentaje */}
                      <div className="space-y-1.5">
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Porcentaje de Recargo (%)</label>
                        <input
                          type="number"
                          value={surchargePercentage}
                          onChange={(e) => setSurchargePercentage(Number(e.target.value))}
                          min="0"
                          max="100"
                          step="0.1"
                          className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-750 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner"
                          placeholder="Ej: 10"
                        />
                      </div>
                    </div>

                    {/* Metodos de pago */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider">Métodos de Pago Aplicables</label>
                      <div className="flex flex-wrap gap-3">
                        {['CLOVER', 'MERCADOPAGO', 'DEBT'].map((method) => {
                          const isChecked = selectedMethods.includes(method);
                          const label = method === 'CLOVER' ? 'Clover' : method === 'MERCADOPAGO' ? 'MercadoPago' : 'Cuenta Corriente';
                          return (
                            <button
                              key={method}
                              type="button"
                              onClick={() => toggleMethod(method)}
                              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-2 cursor-pointer ${
                                isChecked
                                  ? 'bg-rose-50 border-rose-500 text-rose-600 shadow-sm'
                                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${isChecked ? 'bg-rose-600 border-rose-600 text-white' : 'border-slate-400'}`}>
                                {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSavingSurcharge}
                      className="btn-primary w-full md:w-auto text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isSavingSurcharge ? 'Guardando...' : 'Configurar Recargo'}
                    </button>
                  </form>
                </div>

                {/* Surcharges List */}
                <div className="card p-6 space-y-4">
                  <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
                    Recargos Configurados
                  </h3>

                  {isLoadingSurcharges ? (
                    <div className="text-center py-6 text-xs text-slate-500 font-bold">Cargando recargos...</div>
                  ) : surcharges.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-500 font-bold">No hay recargos configurados.</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {surcharges.map((s: any) => {
                        const methodsText = s.paymentMethods.map((m: string) => m === 'CLOVER' ? 'Clover' : m === 'MERCADOPAGO' ? 'MercadoPago' : 'Cuenta Corriente').join(', ');
                        return (
                          <div key={s.id} className="py-3 flex items-center justify-between">
                            <div>
                              <div className="text-xs font-extrabold text-slate-850 uppercase">{s.category?.name || 'Categoría Desconocida'}</div>
                              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                Recargo: <span className="text-rose-600 font-bold">+{s.percentage}%</span> en {methodsText}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteSurcharge(s.id)}
                              className="p-2 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Cargas Virtuales Surcharges and Codes */}
                <div className="card p-6 space-y-4">
                  <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
                    Configuración de Cargas Virtuales (1 y 2)
                  </h3>
                  <p className="text-[10px] text-slate-600 leading-relaxed font-semibold">
                    Define los códigos de barra personalizados y sus porcentajes de recargo correspondientes. Al escribir estos códigos y presionar Enter en el POS, se solicitará el monto de la carga.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Carga Virtual 1 */}
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                      <h4 className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">Carga Virtual 1</h4>
                      <div className="space-y-1.5">
                        <label className="block text-[9px] font-bold text-slate-500 uppercase">Código de Barra</label>
                        <input
                          type="text"
                          value={virtual1Code}
                          onChange={(e) => setVirtual1Code(e.target.value)}
                          className="w-full bg-white border border-slate-350 rounded-lg px-3 py-2 text-xs font-bold text-slate-750 outline-none focus:border-rose-500 transition-all uppercase"
                          placeholder="VIRTUAL1"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[9px] font-bold text-slate-500 uppercase">Recargo (%)</label>
                        <input
                          type="number"
                          value={virtual1Surcharge}
                          onChange={(e) => setVirtual1Surcharge(Number(e.target.value))}
                          min="0"
                          max="100"
                          step="0.1"
                          className="w-full bg-white border border-slate-350 rounded-lg px-3 py-2 text-xs font-bold text-slate-750 outline-none focus:border-rose-500 transition-all"
                          placeholder="0"
                        />
                      </div>
                    </div>

                    {/* Carga Virtual 2 */}
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                      <h4 className="text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">Carga Virtual 2</h4>
                      <div className="space-y-1.5">
                        <label className="block text-[9px] font-bold text-slate-500 uppercase">Código de Barra</label>
                        <input
                          type="text"
                          value={virtual2Code}
                          onChange={(e) => setVirtual2Code(e.target.value)}
                          className="w-full bg-white border border-slate-350 rounded-lg px-3 py-2 text-xs font-bold text-slate-750 outline-none focus:border-rose-500 transition-all uppercase"
                          placeholder="VIRTUAL2"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-[9px] font-bold text-slate-500 uppercase">Recargo (%)</label>
                        <input
                          type="number"
                          value={virtual2Surcharge}
                          onChange={(e) => setVirtual2Surcharge(Number(e.target.value))}
                          min="0"
                          max="100"
                          step="0.1"
                          className="w-full bg-white border border-slate-350 rounded-lg px-3 py-2 text-xs font-bold text-slate-750 outline-none focus:border-rose-500 transition-all"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={handleSaveVirtualConfigs}
                      className="btn-primary text-xs font-extrabold uppercase tracking-wider shadow-md active:scale-95 transition-all cursor-pointer"
                    >
                      Guardar Configuración Virtual
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'personal' && isAdmin && (
              <motion.div
                key="personal"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 max-w-4xl"
              >
                {/* Users List */}
                <div className="card p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-300">
                    <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <Users className="w-4.5 h-4.5 text-rose-500" /> Gestión de Personal y Cajeros
                    </h3>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="btn-primary text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer shrink-0"
                    >
                      <UserPlus className="w-4 h-4" /> Crear Cajero
                    </button>
                  </div>

                  {users.length === 0 ? (
                    <div className="text-center py-8 text-slate-405">
                      <Users className="w-12 h-12 text-slate-250 mx-auto mb-2" />
                      <p className="text-xs font-bold uppercase tracking-wider">No hay cajeros cargados</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
                      <table className="w-full min-w-[550px] text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50/50 border-b border-slate-300 text-[10px] uppercase text-slate-450 font-bold tracking-wider">
                            <th className="py-3 px-4">Nombre de Usuario</th>
                            <th className="py-3 px-4">Rol / Permisos</th>
                            <th className="py-3 px-4">Estado</th>
                            <th className="py-3 px-4 text-center">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((u: any) => (
                            <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors font-medium">
                              <td className="py-3 px-4 font-mono font-bold text-rose-600">{u.username}</td>
                              <td className="py-3 px-4">
                                <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border uppercase tracking-wider ${
                                  u.role === 'ADMIN' ? 'bg-rose-50 text-rose-600 border-rose-150' :
                                  u.role === 'SUPERVISOR' ? 'bg-amber-50 text-amber-600 border-amber-150' :
                                  'bg-slate-50 text-slate-650 border-slate-150'
                                }`}>
                                  {u.role === 'ADMIN' ? 'Administrador' : u.role === 'SUPERVISOR' ? 'Supervisor' : 'Cajero'}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <span className={`text-[8.5px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                  u.isActive !== false ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                                }`}>
                                  {u.isActive !== false ? 'Activo' : 'Inactivo'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center flex items-center justify-center gap-1">
                                <button 
                                  onClick={() => handleOpenEditModal(u)}
                                  className="p-2 hover:bg-rose-50 rounded-lg text-slate-600 hover:text-rose-600 active:scale-95 transition-all cursor-pointer"
                                  title="Editar cajero"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => handleDeleteUser(u.id)}
                                  disabled={u.id === user?.id}
                                  className="p-2 hover:bg-rose-50 rounded-lg text-slate-600 hover:text-rose-500 active:scale-95 transition-all cursor-pointer disabled:opacity-30"
                                  title="Eliminar cajero"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Password Change Card */}
                <div className="card p-6 space-y-4">
                  <h3 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2 pb-1 border-b border-slate-300">
                    <Key className="w-4.5 h-4.5 text-rose-500" /> Cambiar Contraseña de Administrador (ADMIN)
                  </h3>
                  <div className="flex gap-3">
                    <input
                      type="password"
                      value={newAdminPassword}
                      onChange={e => setNewAdminPassword(e.target.value)}
                      className="flex-1 bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner"
                      placeholder="Nueva contraseña numérica..."
                    />
                    <button
                      onClick={handleChangeAdminPassword}
                      disabled={isChangingPassword || !newAdminPassword}
                      className="btn-primary text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50 shadow-md active:scale-95 cursor-pointer transition-all shrink-0"
                    >
                      {isChangingPassword ? '...' : <Key className="w-4 h-4" />} Cambiar
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'backups' && isAdmin && (
              <motion.div
                key="backups"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl"
              >
                <div className="card p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-300">
                    <h3 className="text-xs font-bold text-slate-750 uppercase tracking-wider flex items-center gap-2">
                      <Database className="w-4.5 h-4.5 text-rose-500" /> Copias de Seguridad Locales y Programadas (Backup Pro)
                    </h3>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <label className="btn-success text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer disabled:opacity-50">
                        <Upload className="w-4 h-4" /> Cargar Backup (.db)
                        <input
                          type="file"
                          accept=".db,.sqlite"
                          onChange={triggerFileRestore}
                          className="hidden"
                        />
                      </label>
                      <button
                        onClick={handleCreateBackup}
                        disabled={isCreatingBackup}
                        className="btn-primary text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 shadow-md active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4" /> {isCreatingBackup ? 'Generando...' : 'Respaldar Ahora'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6 items-start">
                    <div className="p-5 rounded-2xl border border-rose-50 bg-rose-50/20 space-y-4 2xl:col-span-1">
                      <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5 text-rose-500" />
                        <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">Backups Automáticos</span>
                      </div>
                      
                      <p className="text-[10px] text-slate-700 font-semibold leading-relaxed">
                        Programa copias de seguridad automáticas diarias. El sistema realiza la rotación reteniendo los últimos 15 días en tu disco para proteger tu espacio de almacenamiento.
                      </p>

                      <div className="space-y-3 pt-2">
                        <label className="flex items-center justify-between cursor-pointer group">
                          <span className="text-xs font-bold text-slate-750">Activar Backup Diario</span>
                          <input 
                            type="checkbox" 
                            checked={autoBackupEnabled} 
                            onChange={(e) => setAutoBackupEnabled(e.target.checked)} 
                            className="rounded-md border-slate-400 text-rose-600 focus:ring-rose-500 h-4.5 w-4.5 cursor-pointer"
                          />
                        </label>

                        {autoBackupEnabled && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-1.5">
                            <label className="block text-[9px] font-bold text-slate-600 uppercase tracking-wider">Hora del Backup</label>
                            <input 
                              type="time" 
                              value={backupTime} 
                              onChange={(e) => setBackupTime(e.target.value)} 
                              className="w-full bg-white border border-slate-400 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner cursor-pointer" 
                            />
                          </motion.div>
                        )}

                        <button
                          onClick={handleSaveBackupSettings}
                          disabled={isSavingBackupSettings}
                          className="btn-primary w-full text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          <Check className="w-4 h-4" /> Guardar programación
                        </button>
                      </div>
                    </div>

                    <div className="2xl:col-span-2 space-y-3">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Últimos Backups Guardados en Disco</span>
                      
                      {backups.length === 0 ? (
                        <div className="text-center py-10 bg-slate-50/50 rounded-xl border border-dashed border-slate-400 text-slate-600 text-xs font-bold uppercase tracking-wider">
                          No se han generado backups en este equipo
                        </div>
                      ) : (
                        <div className="overflow-y-auto overflow-x-hidden max-h-[300px] rounded-xl border border-slate-105 bg-white custom-scrollbar">
                          <table className="w-full min-w-0 text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-300 text-[9px] uppercase text-slate-600 font-bold tracking-wider">
                                <th className="py-2.5 px-3">Fecha y Hora</th>
                                <th className="py-2.5 px-3">Tipo</th>
                                <th className="py-2.5 px-3">Tamaño</th>
                                <th className="py-2.5 px-3 text-center">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {backups.map((b, idx) => (
                                <tr key={idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors">
                                  <td className="py-2.5 px-3 font-bold text-slate-700">
                                    {new Date(b.createdAt).toLocaleString('es-AR')}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className={`text-[8.5px] font-extrabold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                                      b.type === 'MANUAL' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-rose-50 text-rose-600 border-rose-100'
                                    }`}>
                                      {b.type}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-700 font-mono">
                                    {(b.size / 1024 / 1024).toFixed(2)} MB
                                  </td>
                                  <td className="py-2.5 px-3 text-center flex items-center justify-center gap-1.5">
                                    <button 
                                      onClick={() => handleDownloadBackup(b.filename)}
                                      className="p-1.5 hover:bg-rose-50 rounded-lg text-rose-600 hover:text-rose-700 active:scale-95 transition-all cursor-pointer inline-flex items-center justify-center"
                                      title="Descargar base de datos local (.db)"
                                    >
                                      <Download className="w-4 h-4" />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setSelectedBackupToRestore(b.filename);
                                        setUploadedFileToRestore(null);
                                        setShowRestoreModal(true);
                                      }}
                                      className="p-1.5 hover:bg-amber-50 rounded-lg text-amber-600 hover:text-amber-700 active:scale-95 transition-all cursor-pointer inline-flex items-center justify-center"
                                      title="Restaurar base de datos desde esta copia"
                                    >
                                      <RotateCcw className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'integraciones' && (
              <motion.div
                key="integraciones"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6 max-w-4xl"
              >
                <div className="card p-6 space-y-4">
                  <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
                    <Link2 className="w-4.5 h-4.5 text-rose-500" /> Integraciones Externas
                  </h3>
                  <p className="text-[10px] text-slate-500 font-semibold -mt-2">
                    Conectá servicios externos opcionales. Esto es independiente de tu Tienda Online propia de Mangano.
                  </p>

                  {localGoogleUser ? (
                    <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-200/80 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        {localGoogleUser.picture ? (
                          <img
                            src={localGoogleUser.picture}
                            referrerPolicy="no-referrer"
                            className="w-12 h-12 rounded-full border-2 border-emerald-500 shadow-md shrink-0 object-cover"
                            alt="Google Profile"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const parent = (e.target as HTMLImageElement).parentElement;
                              if (parent) {
                                const fallback = document.createElement('div');
                                fallback.className = "w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base shrink-0 shadow-md border-2 border-emerald-500";
                                fallback.innerText = localGoogleUser.name?.[0] || 'G';
                                parent.appendChild(fallback);
                              }
                            }}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-base shrink-0">
                            {localGoogleUser.name?.[0]}
                          </div>
                        )}
                        <div>
                          <p className="text-[9px] font-extrabold text-emerald-600 uppercase tracking-widest leading-none">Sesión Corporativa de Google Activa</p>
                          <h4 className="text-sm font-bold text-slate-800 leading-tight mt-1.5">{localGoogleUser.name} <span className="text-xs font-semibold text-slate-600">({localGoogleUser.email})</span></h4>
                          <p className="text-[10px] text-slate-455 font-semibold mt-1">Esta terminal está vinculada correctamente. Los productos se sincronizarán en tiempo real con GoDelivery.</p>
                        </div>
                      </div>
                      <button
                        onClick={handleDisconnectGoogle}
                        className="w-full md:w-auto px-5 py-2.5 rounded-xl border border-rose-250 bg-rose-50 text-rose-600 hover:bg-rose-100/80 transition-all font-extrabold text-xs shadow-sm active:scale-95 cursor-pointer shrink-0 text-center"
                      >
                        Desconectar Google
                      </button>
                    </div>
                  ) : (
                    <div className="bg-gradient-to-r from-rose-500/10 to-amber-500/10 border border-amber-200/80 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-amber-500 text-white flex items-center justify-center font-black text-lg shrink-0 shadow-md border-2 border-amber-400">
                          G
                        </div>
                        <div>
                          <p className="text-[9px] font-extrabold text-amber-600 uppercase tracking-widest leading-none">Vinculación con GoDelivery Pendiente</p>
                          <h4 className="text-sm font-bold text-slate-800 leading-tight mt-1.5">Conectá tu cuenta de Google</h4>
                          <p className="text-[10px] text-slate-455 font-semibold mt-1">Vinculá una cuenta de Google para habilitar la sincronización en tiempo real de tus productos con la tienda online GoDelivery (marketplace externo, opcional).</p>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-3 self-start md:self-auto shrink-0">
                        <button
                          onClick={handleConnectGoogle}
                          className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs shadow-md active:scale-95 transition-all cursor-pointer flex items-center gap-2 border border-slate-750"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.113-5.136 4.113-3.072 0-5.565-2.493-5.565-5.565s2.493-5.565 5.565-5.565c1.378 0 2.637.5 3.613 1.328l3.06-3.06C18.822 3.912 15.69 2.25 12 2.25 6.615 2.25 2.25 6.615 2.25 12s4.365 9.75 9.75 9.75c5.07 0 9.27-3.66 9.27-9.2 0-.6-.054-1.17-.154-1.728H12.24z"/></svg>
                          Iniciar sesión con Google
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'mantenimiento' && (
              <motion.div
                key="mantenimiento"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-4xl"
              >
                <div className="card p-6 border-rose-100 space-y-4">
                  <h3 className="text-xs font-bold text-rose-600 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-rose-100">
                    <ShieldAlert className="w-4.5 h-4.5 text-rose-500 animate-pulse" /> Zona de Peligro (Mantenimiento y Resets)
                  </h3>

                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 flex gap-3 text-xs text-amber-800 leading-relaxed font-semibold">
                    <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p>
                      <b>⚠️ ADVERTENCIA:</b> Las acciones listadas a continuación son <b>IRREVERSIBLES</b> y eliminan datos de producción del sistema. Por motivos de seguridad, requieren confirmación manual escribiendo una palabra clave exacta.
                    </p>
                  </div>

                  <div className="space-y-4 pt-2 divide-y divide-slate-100">
                    {/* Reset Stock */}
                    <div className="space-y-3 pb-4">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <span className="text-xs font-bold text-slate-800 block">Resetear Stock de Inventario a 0</span>
                          <span className="text-[10px] text-slate-600 leading-relaxed block font-medium">
                            Establece el stock de todos los productos activos a 0. Ideal para realizar un inventario completo desde cero.
                          </span>
                        </div>
                        <button 
                          onClick={() => setShowResetStock(true)}
                          className="py-2 px-4 rounded-xl border border-amber-250 bg-amber-50/50 hover:bg-amber-100 text-[10px] font-extrabold text-amber-600 uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Resetear Stock
                        </button>
                      </div>

                      <AnimatePresence>
                        {showResetStock && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 rounded-xl bg-slate-50 border border-slate-400 space-y-3 overflow-hidden">
                            <p className="text-[10px] text-slate-700 font-semibold leading-normal">
                              Para confirmar, escribí la palabra clave <b className="text-amber-600 uppercase">"STOCK"</b> a continuación:
                            </p>
                            <div className="flex gap-2">
                              <input 
                                type="text" 
                                value={stockConfirmWord} 
                                onChange={(e) => setStockConfirmWord(e.target.value)} 
                                className="flex-1 bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-bold text-slate-755 outline-none focus:border-amber-450"
                                placeholder="Escribí STOCK..."
                              />
                              <button 
                                onClick={handleResetStock}
                                disabled={isResettingStock || stockConfirmWord.toUpperCase() !== 'STOCK'}
                                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                              >
                                {isResettingStock ? '...' : 'Confirmar'}
                              </button>
                              <button onClick={() => { setShowResetStock(false); setStockConfirmWord(''); }} className="btn-secondary text-xs font-bold cursor-pointer">Cancelar</button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Clean registers */}
                    <div className="space-y-3 pt-4 pb-4">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <span className="text-xs font-bold text-slate-800 block">Limpia y Vaciar Cajas y Ventas (Recomendado)</span>
                          <span className="text-[10px] text-slate-600 leading-relaxed block font-medium">
                            Elimina el historial completo de arqueos de caja, ventas POS y cobros. Deja la caja totalmente en limpio.
                          </span>
                        </div>
                        <button 
                          onClick={() => setShowResetCajas(true)}
                          className="py-2 px-4 rounded-xl border border-rose-250 bg-rose-50/50 hover:bg-rose-100 text-[10px] font-extrabold text-rose-600 uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Limpiar Caja
                        </button>
                      </div>

                      <AnimatePresence>
                        {showResetCajas && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 rounded-xl bg-slate-50 border border-slate-400 space-y-3 overflow-hidden">
                            <p className="text-[10px] text-slate-700 font-semibold leading-normal">
                              Para confirmar, escribí la palabra clave <b className="text-rose-600 uppercase">"CAJAS"</b> a continuación:
                            </p>
                            <div className="flex gap-2">
                              <input 
                                type="text" 
                                value={cajasConfirmWord} 
                                onChange={(e) => setCajasConfirmWord(e.target.value)} 
                                className="flex-1 bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-bold text-slate-755 outline-none focus:border-rose-455"
                                placeholder="Escribí CAJAS..."
                              />
                              <button 
                                onClick={handleResetCajas}
                                disabled={isResettingCajas || cajasConfirmWord.toUpperCase() !== 'CAJAS'}
                                className="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-slate-200 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                              >
                                {isResettingCajas ? '...' : 'Confirmar'}
                              </button>
                              <button onClick={() => { setShowResetCajas(false); setCajasConfirmWord(''); }} className="btn-secondary text-xs font-bold cursor-pointer">Cancelar</button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Empty catalog */}
                    <div className="space-y-3 pt-4">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <span className="text-xs font-bold text-slate-800 block">Vaciar Catálogo de Productos</span>
                          <span className="text-[10px] text-slate-600 leading-relaxed block font-medium">
                            Oculta todos los productos de la base de datos (soft delete). Útil si quieres importar un catálogo local limpio.
                          </span>
                        </div>
                        <button 
                          onClick={() => setShowResetCatalog(true)}
                          className="py-2 px-4 rounded-xl border border-red-250 bg-red-50/50 hover:bg-red-100 text-[10px] font-extrabold text-red-650 uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-sm active:scale-95"
                        >
                          <Database className="w-3.5 h-3.5" /> Vaciar Catálogo
                        </button>
                      </div>

                      <AnimatePresence>
                        {showResetCatalog && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 rounded-xl bg-slate-50 border border-slate-400 space-y-3 overflow-hidden">
                            <p className="text-[10px] text-slate-700 font-semibold leading-normal">
                              Para confirmar, escribí la palabra clave <b className="text-red-600 uppercase">"PRODUCTOS"</b> a continuación:
                            </p>
                            <div className="flex gap-2">
                              <input 
                                type="text" 
                                value={catalogConfirmWord} 
                                onChange={(e) => setCatalogConfirmWord(e.target.value)} 
                                className="flex-1 bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-bold text-slate-755 outline-none focus:border-red-450"
                                placeholder="Escribí PRODUCTOS..."
                              />
                              <button 
                                onClick={handleResetCatalog}
                                disabled={isResettingCatalog || catalogConfirmWord.toUpperCase() !== 'PRODUCTOS'}
                                className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-slate-200 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                              >
                                {isResettingCatalog ? '...' : 'Confirmar'}
                              </button>
                              <button onClick={() => { setShowResetCatalog(false); setCatalogConfirmWord(''); }} className="btn-secondary text-xs font-bold cursor-pointer">Cancelar</button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Hard Reset */}
                    <div className="space-y-3 pt-4">
                      <div className="flex justify-between items-start gap-4">
                        <div className="flex-1">
                          <span className="text-xs font-bold text-rose-700 block flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-rose-500 animate-pulse" /> Hard Reset (Limpieza Total de BD)
                          </span>
                          <span className="text-[10px] text-slate-600 leading-relaxed block font-medium">
                            Borra ABSOLUTAMENTE TODO de la base de datos (ventas, cajas, clientes, proveedores, stock, productos, categorías y usuarios) dejando únicamente el usuario admin activo con contraseña "1234". Esta acción es permanente e irreversible.
                          </span>
                        </div>
                        <button 
                          onClick={() => setShowHardReset(true)}
                          className="py-2 px-4 rounded-xl border border-red-350 bg-red-500 hover:bg-red-600 text-[10px] font-extrabold text-white uppercase tracking-wider transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-md active:scale-95"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" /> Hard Reset
                        </button>
                      </div>

                      <AnimatePresence>
                        {showHardReset && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="p-4 rounded-xl bg-red-50/50 border border-red-200 space-y-3 overflow-hidden">
                            <p className="text-[10px] text-red-700 font-bold leading-normal">
                              ⚠️ ATENCIÓN: Se eliminará todo el historial y catálogo. Para confirmar, escribí la palabra clave <b className="text-red-600 uppercase">"BORRAR TODO"</b> a continuación:
                            </p>
                            <div className="flex gap-2">
                              <input 
                                type="text" 
                                value={hardResetConfirmWord} 
                                onChange={(e) => setHardResetConfirmWord(e.target.value)} 
                                className="flex-1 bg-white border border-red-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-750 outline-none focus:border-red-500"
                                placeholder="Escribí BORRAR TODO..."
                              />
                              <button 
                                onClick={handleHardReset}
                                disabled={isHardResetting || hardResetConfirmWord.toUpperCase() !== 'BORRAR TODO'}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                              >
                                {isHardResetting ? '...' : 'Confirmar Reset'}
                              </button>
                              <button onClick={() => { setShowHardReset(false); setHardResetConfirmWord(''); }} className="btn-secondary text-xs font-bold cursor-pointer">Cancelar</button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Columna derecha: estado de la configuración ── */}
        <aside className="hidden 2xl:flex w-[300px] shrink-0 flex-col gap-4 py-6 pr-6 overflow-y-auto custom-scrollbar">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Estado</p>
                <h3 className="text-[15px] font-bold text-slate-900 mt-1">
                  {setupDone === setupSteps.length ? '¡Todo configurado!' : 'Terminá de configurarlo'}
                </h3>
              </div>
              <span className="text-[13px] font-bold text-slate-700 tabular-nums">{setupPercent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 mt-3 overflow-hidden">
              <div className="h-full rounded-full bg-rose-600 transition-all duration-500" style={{ width: `${setupPercent}%` }} />
            </div>
            <ul className="mt-4 space-y-1">
              {setupSteps.map((step) => (
                <li key={step.label}>
                  <button
                    onClick={() => setActiveTab(step.tab)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left hover:bg-slate-50 transition-colors group"
                  >
                    {step.done
                      ? <CheckCircle2 className="w-4 h-4 text-rose-600 shrink-0" />
                      : <Circle className="w-4 h-4 text-amber-400 shrink-0" />}
                    <span className={`flex-1 text-[12.5px] ${step.done ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700 font-medium'}`}>{step.label}</span>
                    {!step.done && <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-slate-900 text-white rounded-2xl p-5">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-lime-300">Este equipo</p>
            <h3 className="text-[15px] font-bold mt-1 truncate">{terminalName}</h3>
            <p className="text-[11.5px] text-slate-400 mt-1 font-mono truncate" title={terminalUuid}>{terminalUuid}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="chip-lime">{businessType === 'FERRETERIA' ? 'Ferretería' : 'Kiosco'}</span>
              {performanceMode && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-white/10 text-slate-200">Modo rendimiento</span>}
            </div>
          </div>
        </aside>
      </div>
      {/* Create User Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-400 flex flex-col p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-rose-500" /> Crear Cajero / Usuario
                </h3>
                <button onClick={() => setShowCreateModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Nombre de Usuario</label>
                  <input 
                    type="text" 
                    value={newUsername} 
                    onChange={(e) => setNewUsername(e.target.value.toUpperCase().replace(/\s+/g, ''))} 
                    className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                    placeholder="Ej: JUAN.PEREZ" 
                    required 
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Contraseña</label>
                  <div className="relative">
                    <input 
                      type="password" 
                      value={newPassword} 
                      onChange={(e) => setNewPassword(e.target.value)} 
                      className="w-full bg-slate-50 border border-slate-400 rounded-xl pl-4 pr-10 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                      placeholder="Ingresá contraseña segura..." 
                      required 
                    />
                    <Key className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Rol / Permisos</label>
                  <select 
                    value={newRole} 
                    onChange={(e) => setNewRole(e.target.value)} 
                    className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-750 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner cursor-pointer"
                  >
                    <option value="CASHIER">Cajero (Operador POS)</option>
                    <option value="SUPERVISOR">Supervisor</option>
                    <option value="ADMIN">Administrador (Acceso Completo)</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="submit" 
                    disabled={isCreatingUser}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <UserPlus className="w-4.5 h-4.5" /> {isCreatingUser ? 'Guardando...' : 'Crear Usuario'}
                  </button>
                  <button type="button" onClick={() => setShowCreateModal(false)} className="px-5 py-3.5 rounded-xl border border-slate-400 text-slate-700 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit User Modal */}
      <AnimatePresence>
        {showEditModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowEditModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-400 flex flex-col p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Edit className="w-5 h-5 text-rose-500" /> Editar Cajero / Usuario
                </h3>
                <button onClick={() => setShowEditModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <form onSubmit={handleEditUser} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Nombre de Usuario</label>
                  <input 
                    type="text" 
                    value={editUsername} 
                    onChange={(e) => setEditUsername(e.target.value.toUpperCase().replace(/\s+/g, ''))} 
                    className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                    placeholder="Ej: JUAN.PEREZ" 
                    required 
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Nueva Contraseña (Dejar vacío para no cambiar)</label>
                  <div className="relative">
                    <input 
                      type="password" 
                      value={editPassword} 
                      onChange={(e) => setEditPassword(e.target.value)} 
                      className="w-full bg-slate-50 border border-slate-400 rounded-xl pl-4 pr-10 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                      placeholder="Nueva contraseña numérica..." 
                    />
                    <Key className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Rol / Permisos</label>
                  <select 
                    value={editRole} 
                    onChange={(e) => setEditRole(e.target.value)} 
                    className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-750 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner cursor-pointer"
                  >
                    <option value="CASHIER">Cajero (Operador POS)</option>
                    <option value="SUPERVISOR">Supervisor</option>
                    <option value="ADMIN">Administrador (Acceso Completo)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-400 rounded-xl shadow-inner">
                  <span className="text-[10px] font-bold text-slate-700 uppercase">Usuario Activo</span>
                  <input 
                    type="checkbox" 
                    checked={editIsActive} 
                    onChange={(e) => setEditIsActive(e.target.checked)} 
                    className="rounded-md border-slate-400 text-rose-650 focus:ring-rose-500 h-4.5 w-4.5"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="submit" 
                    disabled={isSavingEdit}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Save className="w-4.5 h-4.5" /> {isSavingEdit ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                  <button type="button" onClick={() => setShowEditModal(false)} className="px-5 py-3.5 rounded-xl border border-slate-400 text-slate-700 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Backup preparado: se aplica al reiniciar */}
      {pendingRestartMessage && (
        <div className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-amber-50 flex items-center gap-2.5">
              <span className="text-2xl">♻️</span>
              <h2 className="text-base font-bold text-slate-800">Reiniciá Ventra para terminar</h2>
            </div>
            <div className="p-6 space-y-3 text-sm text-slate-700">
              <p>{pendingRestartMessage}</p>
              <p className="text-xs text-slate-500">
                No se perdió nada: la base actual quedó guardada como copia de seguridad antes de reemplazarla.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                onClick={() => setPendingRestartMessage(null)}
                className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Backup Modal */}
      <AnimatePresence>
        {showRestoreModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { if (!isRestoring) { setShowRestoreModal(false); setSelectedBackupToRestore(null); setUploadedFileToRestore(null); setRestoreConfirmWord(''); } }}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-400 flex flex-col p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" /> Confirmar Restauración de Backup
                </h3>
                <button 
                  disabled={isRestoring}
                  onClick={() => { setShowRestoreModal(false); setSelectedBackupToRestore(null); setUploadedFileToRestore(null); setRestoreConfirmWord(''); }} 
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 rounded-xl bg-amber-50 border border-amber-150 flex gap-3 text-xs text-amber-900 leading-relaxed font-semibold">
                <Info className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold uppercase">⚠️ ¡ADVERTENCIA CRÍTICA!</p>
                  <p className="mt-1">
                    Estás a punto de reemplazar la base de datos completa por el archivo seleccionado. 
                    Esto <b>sobrescribirá de forma definitiva</b> todas las ventas, productos, stock, configuraciones y cajas activas en este terminal.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-700 font-bold">
                  Archivo a restaurar: <span className="font-mono text-slate-800 break-all">{uploadedFileToRestore ? uploadedFileToRestore.name : selectedBackupToRestore}</span>
                </p>

                <p className="text-[10px] text-slate-700 font-semibold leading-normal">
                  Para confirmar el reemplazo completo de la base de datos, escribí la palabra clave <b className="text-amber-600 uppercase">"RESTAURAR"</b> a continuación:
                </p>
                
                <input 
                  type="text" 
                  value={restoreConfirmWord} 
                  disabled={isRestoring}
                  onChange={(e) => setRestoreConfirmWord(e.target.value)} 
                  className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-inner"
                  placeholder="Escribí RESTAURAR..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={handleRestoreBackup}
                  disabled={isRestoring || restoreConfirmWord.toUpperCase() !== 'RESTAURAR'}
                  className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
                >
                  <RotateCcw className="w-4.5 h-4.5" /> {isRestoring ? 'Restaurando...' : 'Reemplazar Base de Datos'}
                </button>
                <button 
                  type="button" 
                  disabled={isRestoring}
                  onClick={() => { setShowRestoreModal(false); setSelectedBackupToRestore(null); setUploadedFileToRestore(null); setRestoreConfirmWord(''); }} 
                  className="px-5 py-3.5 rounded-xl border border-slate-400 text-slate-700 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                >
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
