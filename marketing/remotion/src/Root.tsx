import { Composition } from 'remotion';
import { Prueba } from './Prueba';
import { ReelRecargo } from './reel-recargo/ReelRecargo';
import { FPS, duracionTotal } from './reel-recargo/guion';
import { Reel2347 } from './reel-2347/Reel2347';
import guion2347 from './reel-2347/guion.json';
import { ReelFaltazos } from './reel-faltazos/ReelFaltazos';
import { ReelAgendaPro } from './reel-agenda-pro/ReelAgendaPro';
import { TOTAL as TOTAL_AGENDA_PRO } from './reel-agenda-pro/guion';
import guionFaltazos from './reel-faltazos/guion.json';
import { ReelGo } from './reel-go/ReelGo';
import { TOTAL as TOTAL_GO } from './reel-go/guion';
import { ReelPaulos, TOTAL as TOTAL_PAULOS } from './reel-paulos/ReelPaulos';

// Reels e historias: 1080x1920, 30 fps
export const RemotionRoot = () => (
  <>
    <Composition
      id="Prueba"
      component={Prueba}
      durationInFrames={90}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ titulo: 'Ventra', bajada: 'Tu negocio, en orden' }}
    />
    <Composition id="ReelPaulos" component={ReelPaulos} durationInFrames={TOTAL_PAULOS} fps={30} width={1080} height={1920} />
    <Composition id="ReelGo" component={ReelGo} durationInFrames={TOTAL_GO} fps={30} width={1080} height={1920} />
    <Composition id="ReelAgendaPro" component={ReelAgendaPro} durationInFrames={TOTAL_AGENDA_PRO} fps={30} width={1080} height={1920} />
    <Composition id="ReelFaltazos" component={ReelFaltazos} durationInFrames={guionFaltazos.total} fps={guionFaltazos.fps} width={1080} height={1920} />
    <Composition id="Reel2347" component={Reel2347} durationInFrames={guion2347.total} fps={guion2347.fps} width={1080} height={1920} />
    <Composition id="ReelRecargo" component={ReelRecargo} durationInFrames={duracionTotal()} fps={FPS} width={1080} height={1920} />
  </>
);
