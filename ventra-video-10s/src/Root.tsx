import React from 'react';
import { Composition, Folder, Still } from 'remotion';
import { Ventra10s, Ventra15s } from './Ventra10s';
import { BoletaFoto } from './BoletaFoto';
import { BoletaLargaFoto } from './boletas/BoletaLarga';
import { Boletas20 } from './boletas/Boletas20';
import { VentriEp01 } from './ventri/VentriEp01';
import guionVentri01 from './ventri/guion-ep01.json';
import { VentriEp02, VentriEp02Portada } from './ventri/VentriEp02';
import guionVentri02 from './ventri/guion-ep02.json';
import { VentriCorto, GuionCorto } from './ventri/VentriCorto';
import corto01 from './ventri/cortos/corto-01.json';
import { Origen, duracionOrigen } from './origen/Origen';
import { OrigenVoz, duracionOrigenVoz } from './origen/OrigenVoz';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Ventra10s" component={Ventra10s} durationInFrames={300} fps={30} width={1080} height={1920} />
    <Composition id="Ventra15s" component={Ventra15s} durationInFrames={450} fps={30} width={1080} height={1920} />
    <Composition id="Boletas20s" component={Boletas20} durationInFrames={552} fps={30} width={1080} height={1920} />
    <Composition id="VentriEp01" component={VentriEp01} durationInFrames={guionVentri01.total} fps={30} width={1080} height={1920} />
    <Composition id="VentriEp02" component={VentriEp02} durationInFrames={guionVentri02.total} fps={30} width={1080} height={1920} />
    <Still id="VentriEp02Portada" component={VentriEp02Portada} width={1080} height={1920} />
    <Folder name="VentriCortos">
      {/* La fábrica (scripts/ventri-fabrica.py) renderiza esta con --props={"g": guion} */}
      <Composition
        id="VentriCorto" component={VentriCorto} defaultProps={{ g: corto01 as unknown as GuionCorto }}
        calculateMetadata={({ props }) => ({ durationInFrames: props.g.total })}
        durationInFrames={corto01.total} fps={30} width={1080} height={1920}
      />
      <Composition id="VentriCorto01" component={() => <VentriCorto g={corto01 as unknown as GuionCorto} />} durationInFrames={corto01.total} fps={30} width={1080} height={1920} />
    </Folder>
    <Folder name="Origen">
      {/* "Me hice mi propio sistema": el dueño a cámara; una por cada gancho (marketing/origen/GUION.md) */}
      <Composition id="OrigenA" component={() => <Origen gancho="a" />} durationInFrames={duracionOrigen('a')} fps={30} width={1080} height={1920} />
      <Composition id="OrigenB" component={() => <Origen gancho="b" />} durationInFrames={duracionOrigen('b')} fps={30} width={1080} height={1920} />
      <Composition id="OrigenC" component={() => <Origen gancho="c" />} durationInFrames={duracionOrigen('c')} fps={30} width={1080} height={1920} />
      {/* Versión solo voz, sin cara (marketing/origen/GUION-VOZ.md) */}
      <Composition id="OrigenVozA" component={() => <OrigenVoz gancho="a" />} durationInFrames={duracionOrigenVoz('a')} fps={30} width={1080} height={1920} />
      <Composition id="OrigenVozB" component={() => <OrigenVoz gancho="b" />} durationInFrames={duracionOrigenVoz('b')} fps={30} width={1080} height={1920} />
      <Composition id="OrigenVozC" component={() => <OrigenVoz gancho="c" />} durationInFrames={duracionOrigenVoz('c')} fps={30} width={1080} height={1920} />
    </Folder>
    <Folder name="Material">
      <Still id="BoletaFoto" component={BoletaFoto} width={900} height={1200} />
      <Still id="BoletaLargaFoto" component={BoletaLargaFoto} width={900} height={1600} />
    </Folder>
  </>
);
