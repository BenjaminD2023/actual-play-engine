import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, FederatedPointerEvent } from 'pixi.js';
import type { ProjectedLiveScene } from '@actualplay/protocol';
import { LAYER_ORDER, clampCamera, screenToWorld, tokenAtWorld, type Camera } from './layers.js';

export interface VttCanvasProps {
  live: ProjectedLiveScene | null;
  camera?: Camera;
  onMoveToken?: (tokenId: string, x: number, y: number) => void;
  reducedMotion?: boolean;
  interactive?: boolean;
}

export function VttCanvas(props: VttCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layersRef = useRef<Map<string, Container>>(new Map());
  const liveRef = useRef(props.live);
  const cameraRef = useRef(props.camera);
  const moveRef = useRef(props.onMoveToken);
  liveRef.current = props.live;
  cameraRef.current = props.camera;
  moveRef.current = props.onMoveToken;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    const app = new Application();
    void app
      .init({ background: '#141414', resizeTo: el, antialias: true, preference: 'webgl' })
      .then(() => {
        if (cancelled) {
          app.destroy();
          return;
        }
        appRef.current = app;
        el.appendChild(app.canvas as HTMLCanvasElement);
        (app.canvas as HTMLCanvasElement).dataset.testid = 'vtt-surface';
        const layers = new Map<string, Container>();
        for (const name of LAYER_ORDER) {
          const layer = new Container();
          layer.label = name;
          layers.set(name, layer);
          app.stage.addChild(layer);
        }
        layersRef.current = layers;
        app.stage.eventMode = 'static';
        app.stage.hitArea = app.screen;
        let dragging: { id: string } | null = null;
        app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
          if (!props.interactive && !moveRef.current) return;
          const live = liveRef.current;
          if (!live) return;
          const cam = clampCamera(cameraRef.current ?? live.camera);
          const local = event.getLocalPosition(app.stage);
          const world = screenToWorld({ x: local.x, y: local.y }, { x: 0, y: 0, zoom: 1, rotation: 0 });
          const adjusted = {
            x: world.x / cam.zoom + cam.x,
            y: world.y / cam.zoom + cam.y,
          };
          const id = tokenAtWorld(live.tokens, adjusted);
          if (id) dragging = { id };
        });
        app.stage.on('pointerup', (event: FederatedPointerEvent) => {
          if (!dragging) return;
          const live = liveRef.current;
          const cam = clampCamera(cameraRef.current ?? live?.camera ?? { x: 0, y: 0, zoom: 1, rotation: 0 });
          const local = event.getLocalPosition(app.stage);
          const x = local.x / cam.zoom + cam.x;
          const y = local.y / cam.zoom + cam.y;
          moveRef.current?.(dragging.id, x, y);
          dragging = null;
        });
        renderScene(layers, liveRef.current, cameraRef.current, Boolean(props.reducedMotion));
      });
    return () => {
      cancelled = true;
      app.destroy();
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!appRef.current) return;
    renderScene(layersRef.current, props.live, props.camera, Boolean(props.reducedMotion));
  }, [props.live, props.camera, props.reducedMotion]);

  return <div ref={host} className="ap-vtt-canvas" data-testid="vtt-canvas" role="application" aria-label="Virtual tabletop" />;
}

function renderScene(
  layers: Map<string, Container>,
  live: ProjectedLiveScene | null,
  camera: Camera | undefined,
  reducedMotion: boolean
) {
  for (const layer of layers.values()) layer.removeChildren();
  if (!live) return;
  const cam = clampCamera(camera ?? live.camera);

  const background = new Graphics();
  background.rect(0, 0, 1600, 1000);
  background.setFillStyle({ color: 0x1a1c16 });
  background.fill();
  layers.get('background')?.addChild(background);

  const grid = new Graphics();
  if (live.grid.mode !== 'gridless') {
    grid.setStrokeStyle({ width: 1, color: 0x3a3a3a, alpha: live.grid.opacity });
    for (let x = 0; x < 1600; x += live.grid.size) grid.moveTo(x, 0).lineTo(x, 1000);
    for (let y = 0; y < 1000; y += live.grid.size) grid.moveTo(0, y).lineTo(1600, y);
    grid.stroke();
  }
  layers.get('grid')?.addChild(grid);

  const terrain = new Graphics();
  terrain.setFillStyle({ color: 0x4a3b1a, alpha: 0.35 });
  for (const region of live.terrain) {
    if (region.points[0]) terrain.rect(region.points[0].x, region.points[0].y, 80, 80);
  }
  terrain.fill();
  layers.get('terrain')?.addChild(terrain);

  const walls = new Graphics();
  walls.setStrokeStyle({ width: 3, color: 0x88aadd });
  for (const wall of live.walls) walls.moveTo(wall.a.x, wall.a.y).lineTo(wall.b.x, wall.b.y);
  walls.stroke();
  layers.get('walls')?.addChild(walls);

  const lighting = new Graphics();
  for (const light of live.lights) {
    lighting.circle(light.x, light.y, light.dim);
    lighting.setFillStyle({ color: 0xffe9a8, alpha: reducedMotion ? 0.08 : 0.12 });
    lighting.fill();
  }
  layers.get('lighting')?.addChild(lighting);

  const fog = new Graphics();
  fog.setFillStyle({ color: 0x000000, alpha: 0.35 });
  for (const op of live.fog) {
    if (op.points.length >= 2) fog.rect(op.points[0]!.x, op.points[0]!.y, 70, 70);
  }
  fog.fill();
  layers.get('fog')?.addChild(fog);

  const tokens = layers.get('tokens');
  const auras = layers.get('auras');
  for (const token of live.tokens) {
    for (const aura of token.auras) {
      const ag = new Graphics();
      ag.circle(token.x, token.y, aura.radius);
      ag.setStrokeStyle({ width: 1, color: 0x66ff99, alpha: 0.6 });
      ag.stroke();
      auras?.addChild(ag);
    }
    const g = new Graphics();
    g.circle(token.x, token.y, Math.max(12, token.width / 2));
    g.setFillStyle({ color: token.disposition === 'enemy' ? 0xc45c5c : 0x5c8ec4 });
    g.fill();
    g.eventMode = 'static';
    g.cursor = 'pointer';
    g.label = token.id;
    tokens?.addChild(g);
  }

  const annotations = new Graphics();
  annotations.setStrokeStyle({ width: 2, color: 0xf3f1ea });
  for (const item of live.annotations) {
    if (item.points[0]) annotations.circle(item.points[0].x, item.points[0].y, 6);
  }
  annotations.stroke();
  layers.get('annotations')?.addChild(annotations);

  const selection = new Graphics();
  selection.setStrokeStyle({ width: 1, color: 0xe2b14a, alpha: 0.8 });
  for (const item of live.templates) {
    selection.circle(item.origin.x, item.origin.y, Math.max(20, item.length / 2));
  }
  selection.stroke();
  layers.get('selection')?.addChild(selection);

  for (const layer of layers.values()) {
    layer.scale.set(cam.zoom);
    layer.position.set(-cam.x * cam.zoom, -cam.y * cam.zoom);
  }
}
