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
import { ReelBot, ReelBotMano, ReelBotPC, TOTAL as TOTAL_BOT } from './reel-bot/ReelBot';
import { ReelBotPantalla } from './reel-bot/Pantalla';

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
    <Composition id="ReelBot" component={ReelBot} durationInFrames={TOTAL_BOT} fps={30} width={1080} height={1920} />
    <Composition id="ReelBotMano" component={ReelBotMano} durationInFrames={TOTAL_BOT} fps={30} width={1080} height={1920} />
    <Composition id="ReelBotPC" component={ReelBotPC} durationInFrames={TOTAL_BOT} fps={30} width={1080} height={1920} />
    <Composition id="ReelBotPortada" component={ReelBotPC} defaultProps={{ portada: true }} durationInFrames={TOTAL_BOT} fps={30} width={1080} height={1920} />
    <Composition id="ReelBotManoCapa" component={ReelBotMano} defaultProps={{ capa: true }} durationInFrames={TOTAL_BOT} fps={30} width={1080} height={1920} />
    <Composition id="ReelBotPantalla" component={ReelBotPantalla} durationInFrames={TOTAL_BOT} fps={30} width={600} height={1298} />
    <Composition id="ReelPaulos" component={ReelPaulos} durationInFrames={TOTAL_PAULOS} fps={30} width={1080} height={1920} />
    <Composition id="ReelGo" component={ReelGo} durationInFrames={TOTAL_GO} fps={30} width={1080} height={1920} />
    <Composition id="ReelAgendaPro" component={ReelAgendaPro} durationInFrames={TOTAL_AGENDA_PRO} fps={30} width={1080} height={1920} />
    <Composition id="ReelFaltazos" component={ReelFaltazos} durationInFrames={guionFaltazos.total} fps={guionFaltazos.fps} width={1080} height={1920} />
    <Composition id="Reel2347" component={Reel2347} durationInFrames={guion2347.total} fps={guion2347.fps} width={1080} height={1920} />
    <Composition id="ReelRecargo" component={ReelRecargo} durationInFrames={duracionTotal()} fps={FPS} width={1080} height={1920} />
  </>
);
