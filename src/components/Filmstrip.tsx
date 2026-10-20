import { memo } from 'react';
import { useFrame } from '../filmstrip';
import { filmstripTiles } from '../timelineMath';

const BORDER = 2;

interface Props {
  assetId: string;
  url?: string;
  /** Source in/out, speed and timeline length of the item. */
  in: number;
  out: number;
  speed: number;
  dur: number;
  freeze?: number;
  pps: number;
  /** Tile size in px (height of the item, width from the video's shape). */
  tile: number;
  height: number;
  /** Rendered window in seconds from the item's start. */
  from: number;
  to: number;
}

/** Frames along a video item. Until each one is ready the item's thumbnail background shows through. */
export const Filmstrip = memo(function Filmstrip(p: Props) {
  const tiles = filmstripTiles(p);
  return (
    <span className="tl-film" aria-hidden>
      {tiles.map(({ x, t }) => (
        <Tile key={x} assetId={p.assetId} url={p.url} t={t} x={x - BORDER} w={p.tile} h={p.height} />
      ))}
    </span>
  );
});

const Tile = memo(function Tile({ assetId, url, t, x, w, h }: { assetId: string; url?: string; t: number; x: number; w: number; h: number }) {
  const src = useFrame(assetId, url, t);
  return src ? <img src={src} alt="" draggable={false} decoding="async" style={{ left: x, width: w, height: h }} /> : null;
});
