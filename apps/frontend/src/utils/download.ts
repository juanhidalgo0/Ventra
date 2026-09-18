import api from '../services/api';

/** Descarga un archivo binario desde el backend (con el token de sesión) y lo guarda con el nombre indicado. */
export async function downloadFromApi(url: string, filename: string) {
  const { data } = await api.get(url, { responseType: 'blob', timeout: 0 });
  const href = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(href);
}
