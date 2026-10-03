// SOLO DEMO PÚBLICA: reemplaza a 'firebase/messaging'. Sin avisos al celular en la demo.
export const isSupported = async () => false;
export const getMessaging = (_app?: any) => ({});
export async function getToken(..._args: any[]): Promise<string> { throw new Error('Los avisos al celular no están disponibles en la demo'); }
export const onMessage = () => () => {};
