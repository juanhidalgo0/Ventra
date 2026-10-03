// SOLO DESARROLLO (grabación de videos): el vigilante de capas trabadas se confunde con el
// reloj virtual de la grabación y avisa "Se destrabó la pantalla" sin motivo. Acá no hace nada.
export function startOverlayWatchdog(_onRelease?: (count: number) => void): () => void { return () => {}; }
export function unblockStuckOverlays(_reason: string): number { return 0; }
