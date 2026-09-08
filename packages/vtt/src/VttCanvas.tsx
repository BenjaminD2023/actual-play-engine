import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import type { FogOperation, Point, ProjectedLiveScene, TokenRecord } from '@actualplay/protocol';
import { LAYER_ORDER, clampCamera, screenToWorld, tokenAtWorld, type Camera } from './layers.js';
import { assetUrl, fogPolygon, gridDrawModel, terrainPolygon } from './draw-model.js';

export interface OverlayPing { x: number; y: number; }
export interface OverlayRuler { a: Point; b: Point; }
export interface VttCanvasProps {
  live: ProjectedLiveScene | null;
  camera?: Camera;
  onMoveToken?: (tokenId: string, x: number, y: number) => void;
  onCamera?: (camera: Camera) => void;
  onRegion?: (a: Point, b: Point, kind: 'reveal' | 'hide') => void;
  onSelectToken?: (id: string) => void;
  canMoveToken?: (token: TokenRecord) => boolean;
  tool?: 'select' | 'reveal' | 'hide';
  assetBaseUrl?: string;
  showHidden?: boolean;
  lockCamera?: boolean;
  reducedMotion?: boolean;
  interactive?: boolean;
  pings?: OverlayPing[];
  ruler?: OverlayRuler | null;
}

/** One renderer for every show app; authority and role projection remain on the server. */
export function VttCanvas(props: VttCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const appRef = useRef<Application | null>(null);
  const textures = useRef(new Map<string, Texture>());
  const repaint = useRef<() => void>(() => undefined);
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: 1, rotation: 0 });
  const [error, setError] = useState('');
  const cameraKey = JSON.stringify(props.camera ?? props.live?.camera);

  useEffect(() => {
    camera.current = clampCamera(current.current.camera ?? current.current.live?.camera ?? camera.current);
    repaint.current();
  }, [cameraKey, props.live?.instanceId]);

  useEffect(() => {
    const abort = new AbortController();
    const needed = new Set<string>();
    if (props.live?.mapAssetId) needed.add(props.live.mapAssetId);
    for (const token of props.live?.tokens ?? []) if (token.assetId) needed.add(token.assetId);
    for (const [id, texture] of textures.current) if (!needed.has(id)) { texture.destroy(true); textures.current.delete(id); }
    for (const id of needed) {
      if (textures.current.has(id)) continue;
      const url = id.startsWith('/portraits/') ? id : assetUrl(id, props.assetBaseUrl ?? '/api/actualplay')!;
      void fetch(url, { credentials: 'include', signal: abort.signal }).then(async response => {
        if (!response.ok) throw new Error(`Map/portrait request failed (${response.status}).`);
        const bitmap = await createImageBitmap(await response.blob());
        if (abort.signal.aborted) { bitmap.close(); return; }
        textures.current.set(id, Texture.from(bitmap));
        setError(''); repaint.current();
      }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Asset loading failed.'); });
    }
    return () => abort.abort();
  }, [props.assetBaseUrl, props.live?.mapAssetId, JSON.stringify(props.live?.tokens.map(token => token.assetId))]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const app = new Application();
    const layers = new Map<string, Container>();
    let disposed = false, initialized = false, frame = 0;
    let drag: { id: string; at: Point } | null = null;
    let region: { a: Point; b: Point; kind: 'reveal' | 'hide' } | null = null;
    let pan: { at: Point; camera: Camera } | null = null;
    let fogKey = '', fogTexture: Texture | null = null;
    const fogCanvas = document.createElement('canvas');
    const resizeObserver = new ResizeObserver(() => { if (initialized && !disposed) { app.resize(); repaint.current(); } });
    resizeObserver.observe(element);
    const schedule = () => { if (!frame && initialized && !disposed) frame = requestAnimationFrame(paint); };
    repaint.current = schedule;
    const world = (event: FederatedPointerEvent) => screenToWorld(event.global, camera.current);
    const updateCamera = (next: Camera) => { camera.current = clampCamera(next); current.current.onCamera?.(camera.current); schedule(); };
    const onWheel = (event: WheelEvent) => {
      if (current.current.lockCamera) return;
      event.preventDefault();
      const bounds = app.canvas.getBoundingClientRect();
      const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const before = screenToWorld(screen, camera.current);
      const next = clampCamera({ ...camera.current, zoom: camera.current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1) });
      updateCamera({ ...next, x: before.x - screen.x / next.zoom, y: before.y - screen.y / next.zoom });
    };
    const end = () => {
      if (region) current.current.onRegion?.(region.a, region.b, region.kind);
      if (drag) current.current.onMoveToken?.(drag.id, drag.at.x, drag.at.y);
      drag = null; region = null; pan = null; schedule();
    };
    const cancel = () => { drag = null; region = null; pan = null; schedule(); };
    void app.init({ background: '#171a1d', resizeTo: element, antialias: true, preference: 'webgl', resolution: window.devicePixelRatio || 1, autoDensity: true }).then(() => {
      initialized = true;
      if (disposed) { app.destroy(true, { children: true }); return; }
      appRef.current = app;
      element.appendChild(app.canvas);
      app.canvas.dataset.testid = 'vtt-surface';
      app.canvas.style.touchAction = 'none';
      for (const name of LAYER_ORDER) { const layer = new Container(); layer.label = name; layers.set(name, layer); app.stage.addChild(layer); }
      app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;
      app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
        if (!current.current.live) return;
        const at = world(event);
        if (current.current.interactive && current.current.tool && current.current.tool !== 'select') { region = { a: at, b: at, kind: current.current.tool }; return; }
        const id = tokenAtWorld(current.current.live.tokens, at);
        if (id) {
          current.current.onSelectToken?.(id);
          const token = current.current.live.tokens.find(item => item.id === id)!;
          if (current.current.onMoveToken && !token.locked && (current.current.canMoveToken?.(token) ?? true)) { drag = { id, at }; return; }
        }
        if (!current.current.lockCamera) pan = { at: { ...event.global }, camera: { ...camera.current } };
      });
      app.stage.on('pointermove', (event: FederatedPointerEvent) => {
        if (region) region.b = world(event);
        else if (drag) drag.at = world(event);
        else if (pan) updateCamera({ ...pan.camera, x: pan.camera.x - (event.global.x - pan.at.x) / camera.current.zoom, y: pan.camera.y - (event.global.y - pan.at.y) / camera.current.zoom });
        if (region || drag) schedule();
      });
      app.stage.on('pointerup', end); app.stage.on('pointerupoutside', end); app.stage.on('pointercancel', cancel);
      app.canvas.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('resize', schedule);
      schedule();
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : 'WebGL initialization failed.'); });

    function paint() {
      frame = 0;
      if (disposed || !initialized) return;
      for (const layer of layers.values()) for (const child of layer.removeChildren()) child.destroy({ children: true });
      const { live } = current.current;
      if (!live) return;
      const map = live.mapAssetId ? textures.current.get(live.mapAssetId) : null;
      const bounds = { width: map?.width ?? 1600, height: map?.height ?? 1000 };
      const add = (layer: string, object: Container) => layers.get(layer)?.addChild(object);
      add('background', new Graphics().rect(0, 0, bounds.width, bounds.height).fill('#22292b'));
      if (map) add('background', new Sprite(map));
      const grid = new Graphics();
      const drawGrid = gridDrawModel(live.grid, bounds);
      for (const line of drawGrid.square) grid.moveTo(line.a.x, line.a.y).lineTo(line.b.x, line.b.y);
      for (const hex of drawGrid.hex) polygon(grid, hex.points);
      grid.stroke({ width: 1 / camera.current.zoom, color: '#d4d7ce', alpha: live.grid.opacity }); add('grid', grid);
      for (const region of live.terrain) { const terrain = new Graphics(); polygon(terrain, terrainPolygon(region)); terrain.fill({ color: '#87643c', alpha: 0.3 }); add('terrain', terrain); }
      for (const template of live.templates) {
        const shape = new Graphics();
        if (template.kind === 'rectangle') shape.rect(template.origin.x, template.origin.y, template.length, template.width || template.length / 2);
        else shape.circle(template.origin.x, template.origin.y, Math.max(20, template.length / 2));
        shape.stroke({ width: 2, color: '#efd49a', alpha: 0.7 }); add('selection', shape);
      }
      for (const wall of live.walls) {
        const door = live.doors.find(item => item.wallId === wall.id);
        add('walls', new Graphics().moveTo(wall.a.x, wall.a.y).lineTo(wall.b.x, wall.b.y).stroke({ width: door ? 5 : 3, color: door?.state === 'open' ? '#6bb3a3' : door ? '#efbc60' : '#86959e', alpha: door?.state === 'open' ? 0.5 : 1 }));
      }
      for (const light of live.lights) if (light.enabled) add('lighting', new Graphics().circle(light.x, light.y, light.dim).fill({ color: light.color, alpha: 0.1 }));
      for (const token of live.tokens) {
        const at = drag?.id === token.id ? drag.at : token;
        for (const aura of token.auras) add('auras', new Graphics().circle(at.x, at.y, aura.radius).stroke({ width: 2, color: aura.color, alpha: 0.5 }));
        const art = token.assetId ? textures.current.get(token.assetId) : null;
        const group = new Container(); group.position.set(at.x, at.y);
        const radius = Math.max(12, token.width / 2);
        group.addChild(new Graphics().circle(0, 0, radius).fill(token.disposition === 'enemy' ? '#bf6154' : '#4378a9').stroke({ width: 3, color: token.visibility === 'hidden' ? '#bd89d0' : '#efd49a' }));
        if (art) { const sprite = new Sprite(art); sprite.anchor.set(0.5); sprite.width = token.width; sprite.height = token.height; group.addChild(sprite); }
        if (token.nameplate) { const text = new Text({ text: token.name, style: { fontFamily: 'system-ui, sans-serif', fontSize: 13 / camera.current.zoom, fill: '#ffffff', stroke: { color: '#121519', width: 3 / camera.current.zoom } } }); text.anchor.set(0.5, 0); text.position.set(0, radius + 5 / camera.current.zoom); group.addChild(text); }
        group.alpha = token.visibility === 'hidden' ? 0.55 : 1; add('tokens', group);
      }
      const nextFogKey = JSON.stringify([bounds, live.fog]);
      if (nextFogKey !== fogKey) {
        fogKey = nextFogKey;
        fogTexture?.destroy(true);
        composeFog(fogCanvas, live.fog, bounds);
        fogTexture = Texture.from(fogCanvas);
      }
      if (fogTexture && live.fog.length) { const fog = new Sprite(fogTexture); fog.width = bounds.width; fog.height = bounds.height; fog.alpha = current.current.showHidden ? 0.35 : 1; add('fog', fog); }
      for (const annotation of live.annotations) {
        if (annotation.kind === 'text' && annotation.points[0]) { const text = new Text({ text: annotation.text, style: { fontFamily: 'system-ui', fontSize: 14, fill: annotation.color } }); text.position.set(annotation.points[0].x, annotation.points[0].y); add('annotations', text); }
        else { const shape = new Graphics(); polygon(shape, annotation.points); shape.stroke({ width: 2, color: annotation.color }); add('annotations', shape); }
      }
      if (region) add('selection', new Graphics().rect(Math.min(region.a.x, region.b.x), Math.min(region.a.y, region.b.y), Math.abs(region.a.x - region.b.x), Math.abs(region.a.y - region.b.y)).fill({ color: region.kind === 'reveal' ? '#65b898' : '#cd8473', alpha: 0.2 }).stroke({ width: 2, color: '#efd49a' }));
      for (const ping of current.current.pings ?? []) add('selection', new Graphics().circle(ping.x, ping.y, 18).stroke({ width: 3, color: '#efd49a' }));
      if (current.current.ruler) { const { a, b } = current.current.ruler; add('selection', new Graphics().moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: '#efd49a' })); }
      for (const layer of layers.values()) { layer.scale.set(camera.current.zoom); layer.position.set(-camera.current.x * camera.current.zoom, -camera.current.y * camera.current.zoom); }
      app.canvas.dataset.cameraX = String(camera.current.x); app.canvas.dataset.cameraY = String(camera.current.y); app.canvas.dataset.zoom = String(camera.current.zoom);
      app.canvas.dataset.mapWidth = String(bounds.width); app.canvas.dataset.mapHeight = String(bounds.height);
      app.canvas.dataset.sequence = String(live.lastEventSequence); app.canvas.dataset.grid = live.grid.mode;
    }
    return () => {
      disposed = true; resizeObserver.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule);
      if (initialized) { app.canvas.removeEventListener('wheel', onWheel); app.destroy(true, { children: true }); }
      fogTexture?.destroy(true); appRef.current = null; repaint.current = () => undefined;
    };
  }, []);
  useEffect(() => { repaint.current(); }, [props.live, props.camera, props.pings, props.ruler, props.showHidden]);
  useEffect(() => () => { for (const texture of textures.current.values()) texture.destroy(true); textures.current.clear(); }, []);
  return <div ref={host} className="ap-vtt-canvas" data-testid="vtt-canvas" role="application" aria-label="Virtual tabletop">{error ? <p role="alert" className="vtt-render-error">{error}</p> : null}</div>;
}

function polygon(graphics: Graphics, points: Point[]) {
  if (!points.length) return;
  graphics.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
  graphics.closePath();
}

/** Alpha composition, not even-odd holes: overlapping reveals stay revealed; hides win in order. */
function composeFog(canvas: HTMLCanvasElement, ops: FogOperation[], bounds: { width: number; height: number }) {
  const scale = Math.min(1, 4096 / Math.max(bounds.width, bounds.height));
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale)); canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  const context = canvas.getContext('2d')!; context.scale(scale, scale); context.fillStyle = '#080b0f';
  if (ops.length && ops[0]?.kind !== 'hide') context.fillRect(0, 0, bounds.width, bounds.height);
  for (const op of ops) {
    context.globalCompositeOperation = op.kind === 'reveal' ? 'destination-out' : 'source-over';
    if (op.shape === 'full' || op.kind === 'reset') { context.fillRect(0, 0, bounds.width, bounds.height); continue; }
    const points = fogPolygon(op); if (!points.length) continue;
    context.beginPath(); context.moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.closePath(); context.fill();
  }
}
