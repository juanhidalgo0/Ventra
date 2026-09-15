// Ventra brand mark — uses the exact approved logo file directly (no hand-redrawn
// vector) so the app always shows the pixel-accurate icon, not an approximation.
export function MangoLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <div className={`${className} rounded-[22%] overflow-hidden shrink-0`}>
      <img src="/ventra-logo.png" alt="Ventra" className="w-full h-full object-cover" />
    </div>
  );
}

// Bare mango glyph, no background chip — for contexts where the logo needs to
// sit directly on the page (e.g. login screen) instead of as an app-icon tile.
export function MangoIcon({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <img src="/ventra-logo.png" alt="Ventra" className={`${className} shrink-0 rounded-[22%]`} />
  );
}
