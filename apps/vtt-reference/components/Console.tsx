'use client';

import { useEffect, useState } from 'react';
import { VttCanvas } from '@actualplay/vtt';
import {
  adjustHp,
  commandOnSnapshot,
  fetchLibrary,
  fetchPlayers,
  fetchPolls,
  fetchSession,
  fetchSnapshot,
  panicQLab,
  useVttSnapshot,
  votePoll,
} from '../lib/client-api';

export type ViewMode = 'director' | 'prepare' | 'player' | 'audience' | 'broadcast' | 'projector' | 'overlay' | 'rehearsal';

type Library = Awaited<ReturnType<typeof fetchLibrary>>;

export function Console({ title, mode }: { title: string; mode: ViewMode }) {
  const { snapshot, error, refresh } = useVttSnapshot(1500);
  const [log, setLog] = useState('ready');
  const [players, setPlayers] = useState<Array<{ id: string; auth_user_id: string | null; character_name: string; current_hp: number; max_hp: number }>>([]);
  const [polls, setPolls] = useState<Array<{ id: string; question: string; is_active: boolean; options: Array<{ id: string; option_text: string; vote_count: number }> }>>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [gridMode, setGridMode] = useState('square');
  const [gridSize, setGridSize] = useState(70);
  const [draftTitle, setDraftTitle] = useState('House map');
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const readOnly = mode === 'broadcast' || mode === 'projector' || mode === 'overlay' || mode === 'audience';

  async function run(type: string, payload: Record<string, unknown> = {}) {
    try {
      await commandOnSnapshot(snapshot, type, payload);
      setLog(`${type} ok`);
      await refresh();
      await loadLibrary();
    } catch (err) {
      setLog(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadLibrary() {
    try {
      setLibrary(await fetchLibrary());
    } catch {
      /* not signed in yet */
    }
  }

  async function prepareLiveShow() {
    try {
      const base = await fetchSnapshot();
      const created = (await commandOnSnapshot(base, 'scene.create', { title: 'House map' })) as {
        result: { scene: { id: string } };
      };
      const sceneId = created.result.scene.id;
      await commandOnSnapshot(base, 'scene.publish', { sceneId });
      const inst = (await commandOnSnapshot(base, 'scene.instantiate', { sceneId })) as {
        result: { instance: { id: string } };
      };
      const instanceId = inst.result.instance.id;
      await commandOnSnapshot({ ...base, sceneInstanceId: instanceId }, 'scene.activate', { instanceId });
      const roster = await fetchPlayers();
      const p1 = roster.players.find((player) => player.character_name === 'Ranger');
      const p2 = roster.players.find((player) => player.character_name === 'Cleric');
      const liveSnap = { ...base, sceneInstanceId: instanceId };
      await commandOnSnapshot(liveSnap, 'token.create', {
        name: 'Ranger',
        x: 70,
        y: 70,
        ownerUserId: p1?.auth_user_id ?? 'user-p1',
        playerId: p1?.id ?? 'player-1',
      });
      await commandOnSnapshot(liveSnap, 'token.create', {
        name: 'Cleric',
        x: 180,
        y: 70,
        ownerUserId: p2?.auth_user_id ?? 'user-p2',
        playerId: p2?.id ?? 'player-2',
      });
      await commandOnSnapshot(liveSnap, 'token.create', {
        name: 'Lurker',
        x: 420,
        y: 240,
        visibility: 'hidden',
        disposition: 'enemy',
      });
      await commandOnSnapshot(liveSnap, 'wall.create', {
        a: { x: 40, y: 40 },
        b: { x: 400, y: 40 },
        door: true,
      });
      await commandOnSnapshot(liveSnap, 'fog.reveal', { shape: 'rect', points: [{ x: 40, y: 40 }, { x: 200, y: 200 }] });
      setLog('live show ready');
      await refresh();
      await loadLibrary();
    } catch (err) {
      setLog(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    void loadLibrary();
    void fetchPlayers()
      .then((body) => setPlayers(body.players))
      .catch(() => undefined);
    void fetchPolls()
      .then((body) => setPolls(body.polls))
      .catch(() => undefined);
    void fetchSession()
      .then((body) => setUserId(body.user?.id ?? null))
      .catch(() => undefined);
  }, [refresh]);

  const frameClass = mode === 'broadcast' || mode === 'projector' ? 'board broadcast-frame' : 'board';
  const live = snapshot?.live;
  const selected = live?.tokens.find((token) => token.id === selectedToken) ?? live?.tokens[0] ?? null;
  const qlab = library?.qlab;

  return (
    <div className={frameClass} data-view={mode}>
      <div className="canvas-wrap">
        <VttCanvas
          live={live ?? null}
          camera={live?.camera}
          interactive={!readOnly}
          onMoveToken={
            readOnly
              ? undefined
              : (tokenId, x, y) => {
                  void run('token.move', { tokenId, x, y });
                }
          }
        />
      </div>
      <aside className="side">
        <h1 data-testid="view-title">{title}</h1>
        <p className="status" data-testid="view-status">
          {error ?? log}
        </p>
        <p className="status">
          {live?.status ?? 'idle'} · seq {snapshot?.lastEventSequence ?? 0} · {live?.title ?? 'no live scene'}
        </p>
        {(mode === 'director' || mode === 'prepare' || mode === 'rehearsal') && (
          <>
            {mode === 'rehearsal' && <p className="status">Rehearsal / dry-run. QLab acks are simulated.</p>}
            <button data-testid="prepare-live" onClick={() => void prepareLiveShow()}>
              prepare live show
            </button>
            <section>
              <h2>Scene library</h2>
              <ul data-testid="scene-library">
                {(library?.scenes ?? []).map((scene) => (
                  <li key={scene.id}>
                    {scene.title} · {scene.status}
                    <button onClick={() => void run('scene.publish', { sceneId: scene.id })}>publish</button>
                    <button onClick={() => void run('scene.instantiate', { sceneId: scene.id })}>instantiate</button>
                  </li>
                ))}
              </ul>
              {(library?.instances ?? []).map((instance) => (
                <p key={instance.id}>
                  {instance.title} {instance.status}
                  <button onClick={() => void run('scene.stage', { instanceId: instance.id })}>stage</button>
                  <button onClick={() => void run('scene.activate', { instanceId: instance.id })}>activate</button>
                </p>
              ))}
            </section>
            {mode === 'prepare' && (
              <section>
                <h2>Draft / grid calibration</h2>
                <input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} aria-label="Scene title" />
                <button onClick={() => void run('scene.create', { title: draftTitle, grid: { mode: gridMode, size: gridSize } })}>
                  new draft
                </button>
                <label>
                  Grid
                  <select value={gridMode} onChange={(event) => setGridMode(event.target.value)} aria-label="Grid mode">
                    <option value="square">square</option>
                    <option value="gridless">gridless</option>
                    <option value="hex-flat">hex-flat</option>
                    <option value="hex-pointy">hex-pointy</option>
                  </select>
                </label>
                <label>
                  Size
                  <input
                    type="number"
                    value={gridSize}
                    onChange={(event) => setGridSize(Number(event.target.value))}
                    aria-label="Grid size"
                  />
                </label>
                <button
                  onClick={() =>
                    void run('scene.updateDraft', {
                      sceneId: library?.scenes[0]?.id,
                      grid: { mode: gridMode, size: gridSize },
                    })
                  }
                >
                  apply grid
                </button>
              </section>
            )}
            <section>
              <h2>Map tools</h2>
              <button onClick={() => void run('fog.reveal', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 140, y: 140 }] })}>
                reveal fog
              </button>
              <button onClick={() => void run('fog.hide', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 70, y: 70 }] })}>
                hide fog
              </button>
              <button onClick={() => void run('wall.create', { a: { x: 40, y: 40 }, b: { x: 400, y: 40 }, door: true })}>
                add wall/door
              </button>
              <button
                onClick={() => {
                  const doorId = live?.doors[0]?.id;
                  if (doorId) void run('door.setState', { doorId, state: live?.doors[0]?.state === 'open' ? 'closed' : 'open' });
                }}
              >
                toggle door
              </button>
              <button onClick={() => void run('light.create', { x: 120, y: 120, bright: 80, dim: 160 })}>add light</button>
              <button onClick={() => void run('camera.set', { x: 0, y: 0, zoom: 1 })}>reset camera</button>
              <button onClick={() => void run('ping.create', { x: 80, y: 80 })}>ping</button>
            </section>
            <section>
              <h2>Inspector</h2>
              <select
                aria-label="Selected token"
                value={selected?.id ?? ''}
                onChange={(event) => setSelectedToken(event.target.value)}
              >
                {(live?.tokens ?? []).map((token) => (
                  <option key={token.id} value={token.id}>
                    {token.name}
                  </option>
                ))}
              </select>
              {selected && (
                <p data-testid="token-inspector">
                  {selected.name} {selected.disposition} {selected.visibility} HP from player record
                </p>
              )}
            </section>
            <section>
              <h2>QLab / rundown</h2>
              <p data-testid="qlab-status">
                QLab {qlab?.connected ? 'connected' : qlab?.kind === 'dry-run' ? 'dry-run' : 'disconnected'} {qlab?.lastError ?? ''}
              </p>
              {(library?.rundown ?? []).map((item) => (
                <p key={item.id}>
                  {item.title} {item.state}
                </p>
              ))}
              <button onClick={() => void run('rundown.advance', {})}>advance rundown</button>
              <button onClick={() => void run('recording.marker', { label: 'panic-mark' })}>marker</button>
              <button
                className="danger"
                onClick={() => {
                  void panicQLab().then(() => setLog('panic'));
                }}
              >
                panic
              </button>
            </section>
          </>
        )}
        {mode === 'player' && (
          <div>
            <p>Owned-token drag is on the map. HP:</p>
            {players.filter((player) => player.auth_user_id === userId).map((player) => (
              <p key={player.id}>
                {player.character_name} {player.current_hp}/{player.max_hp}
                <button data-testid={`hp-down-${player.id}`} onClick={() => void adjustHp(player.id, -1).then(() => refresh())}>
                  -1
                </button>
                <button onClick={() => void adjustHp(player.id, 1).then(() => refresh())}>+1</button>
              </p>
            ))}
            <button onClick={() => void run('ping.create', { x: 90, y: 90 })}>ping</button>
          </div>
        )}
        {mode === 'audience' && (
          <div>
            {polls
              .filter((poll) => poll.is_active)
              .map((poll) => (
                <div key={poll.id}>
                  <p>{poll.question}</p>
                  {poll.options.map((option) => (
                    <button
                      key={option.id}
                      data-testid={`vote-${option.option_text}`}
                      onClick={() => void votePoll(poll.id, option.id).then(() => fetchPolls().then((body) => setPolls(body.polls)))}
                    >
                      {option.option_text} ({option.vote_count})
                    </button>
                  ))}
                </div>
              ))}
            {polls.filter((poll) => poll.is_active).length === 0 && <p>No open poll.</p>}
          </div>
        )}
        {(mode === 'broadcast' || mode === 'projector' || mode === 'overlay') && (
          <div data-testid="broadcast-overlay">
            <p className="announce">{live?.announcement || '—'}</p>
            <ul>
              {live?.tokens.map((token) => (
                <li key={token.id}>
                  {token.name} {token.conditions.join(', ')}
                </li>
              ))}
            </ul>
            <div data-testid="broadcast-polls">
              {polls.map((poll) => (
                <p key={poll.id}>
                  {poll.question}{' '}
                  {poll.options.map((option) => `${option.option_text}:${option.vote_count}`).join(' ')}
                </p>
              ))}
            </div>
          </div>
        )}
        <pre className="status">{JSON.stringify(live?.combat ?? {}, null, 2)}</pre>
      </aside>
    </div>
  );
}
