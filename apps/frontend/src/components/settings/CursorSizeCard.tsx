import { useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import { SettingsCard } from './SettingsUI';
import { getCursorGrande, setCursorGrande } from '../../utils/cursorSize';
const flecha = new URL('../../assets/cursors/flecha.svg', import.meta.url).href;
const flechaGrande = new URL('../../assets/cursors/flecha-grande.svg', import.meta.url).href;

/** Tamaño del cursor de esta PC: más grande para quien ve poco o tiene una pantalla grande. */
export default function CursorSizeCard() {
  const [grande, setGrande] = useState(getCursorGrande());
  const options = [
    { value: false, label: 'Normal', img: flecha, px: 32 },
    { value: true, label: 'Grande', img: flechaGrande, px: 48 },
  ];

  return (
    <SettingsCard icon={MousePointer2} title="Tamaño del cursor" scope="pc"
      description="Más grande se encuentra más fácil en la pantalla.">
      <div className="mt-4 grid grid-cols-2 gap-1.5 max-w-xs" role="radiogroup" aria-label="Tamaño del cursor">
        {options.map((o) => (
          <button key={o.label} role="radio" aria-checked={grande === o.value}
            onClick={() => { setCursorGrande(o.value); setGrande(o.value); }}
            className={`rounded-xl border py-2.5 flex flex-col items-center gap-1 transition-colors ${grande === o.value ? 'border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-500/20' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
            <span className="h-12 flex items-center justify-center">
              <img src={o.img} alt="" width={o.px} height={o.px} draggable={false} />
            </span>
            <span className="text-[11px] font-semibold">{o.label}</span>
          </button>
        ))}
      </div>
    </SettingsCard>
  );
}
