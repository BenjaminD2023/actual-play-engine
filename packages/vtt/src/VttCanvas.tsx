import { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Sprite, Texture, FederatedPointerEvent } from 'pixi.js';
import type { ProjectedLiveScene } from '@actualplay/protocol';
import { LAYER_ORDER, clampCamera, screenToWorld, tokenAtWorld, type Camera } from './layers.js';
import { assetUrl, fogDrawList, gridDrawModel, terrainDrawList } from './draw-model.js';

export interface OverlayPing {
  x: number;
  y: number;
}

export interface OverlayRuler {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export interface VttCanvasProps {
  live: ProjectedLiveScene | null;
  camera?: Camera;
  onMoveToken?: (tokenId: string, x: number, y: number) => void;
  onCamera?: (camera: Camera) => void;
  reducedMotion?: boolean;
  interactive?: boolean;
  pings?: OverlayPing[];
  ruler?: OverlayRuler | null;
}

export function VttCanvas(props: VttCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layersRef = useRef<Map<string, Container>>(new Map());
  const liveRef = useRef(props.live);
  const cameraRef = useRef<Camera>(clampCamera(props.camera ?? props.live?.camera ?? { x: 0, y: 0, zoom: 1, rotation: 0 }));
  const moveRef = useRef(props.onMoveToken);
  const onCameraRef = useRef(props.onCamera);
  const pingRef = useRef(props.pings ?? []);
  const rulerRef = useRef(props.ruler ?? null);
  const dragPreviewRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const interactiveRef = useRef(props.interactive);
  liveRef.current = props.live;
  interactiveRef.current = props.interactive;
  moveRef.current = props.onMoveToken;
  onCameraRef.current = props.onCamera;
  pingRef.current = props.pings ?? [];
  rulerRef.current = props.ruler ?? null;
  if (props.camera) cameraRef.current = clampCamera(props.camera);

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
        let panning: { x: number; y: number; camX: number; camY: number } | null = null;
        let rulerStart: { x: number; y: number } | null = null;
        let pointers = new Map<number, { x: number; y: number }>();

        const worldFromEvent = (event: FederatedPointerEvent) => {
          const cam = cameraRef.current;
          const local = event.getLocalPosition(app.stage);
          return screenToWorld({ x: local.x, y: local.y }, cam);
        };

        app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
          const live = liveRef.current;
          if (!live) return;
          const world = worldFromEvent(event);
          pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
          if (event.shiftKey) {
            rulerStart = world;
            rulerRef.current = { a: world, b: world };
            paint();
            return;
          }
          if (interactiveRef.current || moveRef.current) {
            const id = tokenAtWorld(live.tokens, world);
            if (id) {
              dragging = { id };
              dragPreviewRef.current = { id, x: world.x, y: world.y };
              paint();
              return;
            }
          }
          panning = { x: event.global.x, y: event.global.y, camX: cameraRef.current.x, camY: cameraRef.current.y };
        });
        app.stage.on('pointermove', (event: FederatedPointerEvent) => {
          pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
          if (pointers.size === 2) {
            const pts = [...pointers.values()];
            const dx = pts[0]!.x - pts[1]!.x;
            const dy = pts[0]!.y - pts[1]!.y;
            const dist = Math.hypot(dx, dy);
            const prev = (app.stage as unknown as { __pinch?: number }).__pinch;
            (app.stage as unknown as { __pinch?: number }).__pinch = dist;
            if (prev && prev > 0) {
              const factor = dist / prev;
              cameraRef.current = clampCamera({ ...cameraRef.current, zoom: cameraRef.current.zoom * factor });
              onCameraRef.current?.(cameraRef.current);
              paint();
            }
            return;
          }
          const world = worldFromEvent(event);
          if (rulerStart) {
            rulerRef.current = { a: rulerStart, b: world };
            paint();
            return;
          }
          if (dragging) {
            dragPreviewRef.current = { id: dragging.id, x: world.x, y: world.y };
            paint();
            return;
          }
          if (panning) {
            const zoom = cameraRef.current.zoom;
            cameraRef.current = clampCamera({
              ...cameraRef.current,
              x: panning.camX - (event.global.x - panning.x) / zoom,
              y: panning.camY - (event.global.y - panning.y) / zoom,
            });
            onCameraRef.current?.(cameraRef.current);
            paint();
          }
        });
        const endPointer = (event: FederatedPointerEvent) => {
          pointers.delete(event.pointerId);
          (app.stage as unknown as { __pinch?: number }).__pinch = undefined;
          const world = worldFromEvent(event);
          if (rulerStart) {
            rulerStart = null;
            paint();
            return;
          }
          if (dragging) {
            moveRef.current?.(dragging.id, world.x, world.y);
            dragging = null;
            dragPreviewRef.current = null;
            paint();
            return;
          }
          panning = null;
        };
        app.stage.on('pointerup', endPointer);
        app.stage.on('pointerupoutside', endPointer);
        app.stage.on('pointertap', (event: FederatedPointerEvent) => {
          if (event.detail === 2 || event.altKey) {
            const world = worldFromEvent(event);
            pingRef.current = [...pingRef.current, world].slice(-8);
            paint();
          }
        });

        const canvas = app.canvas as HTMLCanvasElement;
        const onWheel = (ev: WheelEvent) => {
          ev.preventDefault();
          const cam = cameraRef.current;
          const factor = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
          const rect = canvas.getBoundingClientRect();
          const before = screenToWorld({ x: ev.clientX - rect.left, y: ev.clientY - rect.top }, cam);
          const next = clampCamera({ ...cam, zoom: cam.zoom * factor });
          const after = screenToWorld({ x: ev.clientX - rect.left, y: ev.clientY - rect.top }, next);
          cameraRef.current = clampCamera({
            ...next,
            x: cam.x + (before.x - after.x),
            y: cam.y + (before.y - after.y),
          });
          onCameraRef.current?.(cameraRef.current);
          paint();
        };
        canvas.addEventListener('wheel', onWheel, { passive: false });
        (canvas as unknown as { __onWheel?: typeof onWheel }).__onWheel = onWheel;

        paint();
      });

    function paint() {
      renderScene(
        layersRef.current,
        liveRef.current,
        cameraRef.current,
        Boolean(props.reducedMotion),
        pingRef.current,
        rulerRef.current,
        dragPreviewRef.current
      );
    }

    return () => {
      cancelled = true;
      const canvas = app.canvas as HTMLCanvasElement & { __onWheel?: (ev: WheelEvent) => void };
      if (canvas.__onWheel) canvas.removeEventListener('wheel', canvas.__onWheel);
      app.destroy();
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!appRef.current) return;
    renderScene(
      layersRef.current,
      props.live,
      cameraRef.current,
      Boolean(props.reducedMotion),
      pingRef.current,
      rulerRef.current,
      dragPreviewRef.current
    );
  }, [props.live, props.camera, props.reducedMotion, props.pings, props.ruler]);

  return <div ref={host} className="ap-vtt-canvas" data-testid="vtt-canvas" role="application" aria-label="Virtual tabletop" />;
}

function poly(g: Graphics, points: { x: number; y: number }[]) {
  if (points.length === 0) return;
  g.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) g.lineTo(points[i]!.x, points[i]!.y);
  g.closePath();
}

function renderScene(
  layers: Map<string, Container>,
  live: ProjectedLiveScene | null,
  camera: Camera | undefined,
  reducedMotion: boolean,
  pings: OverlayPing[],
  ruler: OverlayRuler | null,
  drag: { id: string; x: number; y: number } | null
) {
  for (const layer of layers.values()) layer.removeChildren();
  if (!live) return;
  const cam = clampCamera(camera ?? live.camera);

  const background = new Graphics();
  background.rect(0, 0, 1600, 1000);
  background.setFillStyle({ color: 0x1a1c16 });
  background.fill();
  layers.get('background')?.addChild(background);
  const map = assetUrl(live.mapAssetId);
  if (map) {
    const sprite = new Sprite(Texture.from(map));
    sprite.width = 1600;
    sprite.height = 1000;
    layers.get('background')?.addChild(sprite);
  }

  const grid = new Graphics();
  const model = gridDrawModel(live.grid);
  if (model.mode === 'square') {
    grid.setStrokeStyle({ width: 1, color: 0x3a3a3a, alpha: live.grid.opacity });
    for (const line of model.square) grid.moveTo(line.a.x, line.a.y).lineTo(line.b.x, line.b.y);
    grid.stroke();
  } else if (model.mode === 'hex-flat' || model.mode === 'hex-pointy') {
    grid.setStrokeStyle({ width: 1, color: 0x3a3a3a, alpha: live.grid.opacity });
    for (const cell of model.hex) {
      poly(grid, cell.points);
    }
    grid.stroke();
  }
  layers.get('grid')?.addChild(grid);

  const terrain = new Graphics();
  terrain.setFillStyle({ color: 0x4a3b1a, alpha: 0.35 });
  for (const region of terrainDrawList(live.terrain)) {
    poly(terrain, region.points);
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
  for (const op of fogDrawList(live.fog)) {
    fog.setFillStyle({ color: 0x000000, alpha: op.kind === 'fog-hide' ? 0.55 : 0.28 });
    poly(fog, op.points);
    fog.fill();
  }
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
    if (item.points.length >= 2) {
      annotations.moveTo(item.points[0]!.x, item.points[0]!.y);
      for (let i = 1; i < item.points.length; i += 1) annotations.lineTo(item.points[i]!.x, item.points[i]!.y);
    } else if (item.points[0]) {
      annotations.circle(item.points[0].x, item.points[0].y, 6);
    }
  }
  annotations.stroke();
  layers.get('annotations')?.addChild(annotations);

  const selection = new Graphics();
  selection.setStrokeStyle({ width: 1, color: 0xe2b14a, alpha: 0.8 });
  for (const item of live.templates) {
    if (item.kind === 'rectangle') {
      selection.rect(item.origin.x, item.origin.y, item.length, item.width || item.length / 2);
    } else {
      selection.circle(item.origin.x, item.origin.y, Math.max(20, item.length / 2));
    }
  }
  selection.stroke();
  if (drag) {
    selection.circle(drag.x, drag.y, 16);
    selection.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.9 });
    selection.stroke();
  }
  if (ruler) {
    selection.setStrokeStyle({ width: 2, color: 0xf3d27a });
    selection.moveTo(ruler.a.x, ruler.a.y).lineTo(ruler.b.x, ruler.b.y);
    selection.stroke();
  }
  for (const ping of pings) {
    selection.circle(ping.x, ping.y, 18);
    selection.setStrokeStyle({ width: 2, color: 0xff6688, alpha: 0.9 });
    selection.stroke();
  }
  layers.get('selection')?.addChild(selection);

  for (const layer of layers.values()) {
    layer.scale.set(cam.zoom);
    layer.position.set(-cam.x * cam.zoom, -cam.y * cam.zoom);
  }
}
