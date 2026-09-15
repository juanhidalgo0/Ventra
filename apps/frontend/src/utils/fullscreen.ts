// Toggles fullscreen for the desktop (Tauri) window when running as the packaged
// app, or the browser's own Fullscreen API when running as a web/demo terminal.
export async function toggleFullscreen(): Promise<void> {
  const tauri = (window as any).__TAURI__;
  if (tauri) {
    const invokeFn = tauri.core?.invoke || tauri.invoke;
    if (invokeFn) {
      await invokeFn('toggle_fullscreen').catch((err: any) => console.error('[fullscreen] Tauri toggle failed:', err));
      return;
    }
  }

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (err) {
    console.error('[fullscreen] Browser Fullscreen API failed:', err);
  }
}

export function isFullscreenActive(): boolean {
  return !!document.fullscreenElement;
}
