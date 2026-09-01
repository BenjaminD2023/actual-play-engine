import { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import type { ProjectedLiveScene } from '@actualplay/protocol';
import { LAYER_ORDER, clampCamera, type Camera } from './layers.js';

export interface VttCanvasProps {
  live: ProjectedLiveScene | null;
  camera?: Camera;
  onMoveToken?: (tokenId: string, x: number, y: number) => void;
  reducedMotion?: boolean;
}

export function VttCanvas(props: VttCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    const app = new Application();
    void app.init({ background: '#141414', resizeTo: el, antialias: true }).then(() => {
      if (cancelled) {
        app.destroy();
        return;
      }
      appRef.current = app;
      el.appendChild(app.canvas as HTMLCanvasElement);
      const layers = new Map<string, Container>();
      for (const name of LAYER_ORDER) {
        const layer = new Container();
        layer.label = name;
        layers.set(name, layer);
        app.stage.addChild(layer);
      }
      renderScene(layers, props.live, props.camera);
    });
    return () => {
      cancelled = true;
      app.destroy();
      appRef.current = null;
    };
  }, [props.live, props.camera, props.reducedMotion]);

  return <div ref={host} className="ap-vtt-canvas" role="application" aria-label="Virtual tabletop" />;
}

function renderScene(layers: Map<string, Container>, live: ProjectedLiveScene | null, camera?: Camera) {
  for (const layer of layers.values()) layer.removeChildren();
  if (!live) return;
  const cam = clampCamera(camera ?? live.camera);
  const grid = new Graphics();
  if (live.grid.mode !== 'gridless') {
    grid.setStrokeStyle({ width: 1, color: 0x3a3a3a, alpha: live.grid.opacity });
    for (let x = 0; x < 1400; x += live.grid.size) {
      grid.moveTo(x, 0).lineTo(x, 900);
    }
    for (let y = 0; y < 900; y += live.grid.size) {
      grid.moveTo(0, y).lineTo(1400, y);
    }
    grid.stroke();
  }
  layers.get('grid')?.addChild(grid);

  const walls = new Graphics();
  walls.setStrokeStyle({ width: 3, color: 0x88aadd });
  for (const wall of live.walls) {
    walls.moveTo(wall.a.x, wall.a.y).lineTo(wall.b.x, wall.b.y);
  }
  walls.stroke();
  layers.get('walls')?.addChild(walls);

  const fog = new Graphics();
  fog.setFillStyle({ color: 0x000000, alpha: 0.35 });
  for (const op of live.fog) {
    if (op.points.length >= 2) {
      fog.rect(op.points[0]!.x, op.points[0]!.y, 70, 70);
    }
  }
  fog.fill();
  layers.get('fog')?.addChild(fog);

  const tokens = layers.get('tokens');
  const auras = layers.get('auras');
  for (const token of live.tokens) {
    const g = new Graphics();
    for (const aura of token.auras) {
      const ag = new Graphics();
      ag.circle(token.x, token.y, aura.radius);
      ag.setStrokeStyle({ width: 1, color: 0x66ff99, alpha: 0.6 });
      ag.stroke();
      auras?.addChild(ag);
    }
    g.circle(token.x, token.y, Math.max(12, token.width / 2));
    g.setFillStyle({ color: token.disposition === 'enemy' ? 0xc45c5c : 0x5c8ec4 });
    g.fill();
    tokens?.addChild(g);
  }

  for (const layer of layers.values()) {
    layer.scale.set(cam.zoom);
    layer.position.set(-cam.x * cam.zoom, -cam.y * cam.zoom);
  }
}
