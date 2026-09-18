// Modo rendimiento activado por defecto si el usuario nunca lo configuró.
// Debe importarse antes que cualquier otro módulo (algunos leen el valor al cargar).
try {
  if (localStorage.getItem('performance_mode') === null) {
    localStorage.setItem('performance_mode', 'true');
  }
} catch {}
