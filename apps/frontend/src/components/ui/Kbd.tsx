// Tecla de atajo (F1, Ctrl K, Enter…) con el mismo aspecto en toda la app.
export default function Kbd({ children, tone = 'default', className = '' }: {
  children: React.ReactNode;
  tone?: 'default' | 'onDark';
  className?: string;
}) {
  const tones = {
    default: 'bg-white text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
    onDark: 'bg-white/15 text-white/90 border-white/25',
  };
  return (
    <kbd className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md border text-[10.5px] font-mono font-semibold leading-none ${tones[tone]} ${className}`}>
      {children}
    </kbd>
  );
}
