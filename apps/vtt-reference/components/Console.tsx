'use client';

import { useEffect, useState } from 'react';
import { VttCanvas } from '@actualplay/vtt';
import {
  adjustHp,
  commandOnSnapshot,
  fetchPlayers,
  fetchPolls,
  fetchSession,
  fetchSnapshot,
  useVttSnapshot,
  votePoll,
} from '../lib/client-api';

export type ViewMode = 'director' | 'prepare' | 'player' | 'audience' | 'broadcast' | 'projector' | 'overlay' | 'rehearsal';

export function Console({ title, mode }: { title: string; mode: ViewMode }) {
  const { snapshot, error, refresh } = useVttSnapshot(1500);
  const [log, setLog] = useState('ready');
  const [players, setPlayers] = useState<Array<{ id: string; auth_user_id: string | null; character_name: string; current_hp: number; max_hp: number }>>([]);
  const [polls, setPolls] = useState<Array<{ id: string; question: string; is_active: boolean; options: Array<{ id: string; option_text: string; vote_count: number }> }>>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const readOnly = mode === 'broadcast' || mode === 'projector' || mode === 'overlay' || mode === 'audience';

  async function run(type: string, payload: Record<string, unknown> = {}) {
    try {
      await commandOnSnapshot(snapshot, type, payload);
      setLog(`${type} ok`);
      await refresh();
    } catch (err) {
      setLog(err instanceof Error ? err.message : String(err));
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
    } catch (err) {
      setLog(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
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

  return (
    <div className={frameClass} data-view={mode}>
      <div className="canvas-wrap">
        <VttCanvas
          live={snapshot?.live ?? null}
          camera={snapshot?.live?.camera}
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
          {snapshot?.live?.status ?? 'idle'} · seq {snapshot?.lastEventSequence ?? 0} · {snapshot?.live?.title ?? 'no live scene'}
        </p>
        {(mode === 'director' || mode === 'prepare' || mode === 'rehearsal') && (
          <>
            <button data-testid="prepare-live" onClick={() => void prepareLiveShow()}>
              prepare live show
            </button>
            <button onClick={() => void run('ping.create', { x: 80, y: 80 })}>ping</button>
            <button onClick={() => void run('fog.reveal', { shape: 'rect', points: [{ x: 0, y: 0 }, { x: 70, y: 70 }] })}>
              reveal fog
            </button>
            <button className="danger" onClick={() => void run('recording.marker', { label: 'panic-mark' })}>
              marker
            </button>
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
            <button
              data-testid="open-poll"
              onClick={() => void run('poll.open', { question: 'What now?', options: ['Fight', 'Talk'] })}
            >
              open poll
            </button>
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
          </div>
        )}
        {(mode === 'broadcast' || mode === 'projector' || mode === 'overlay') && (
          <div data-testid="broadcast-overlay">
            <p className="announce">{snapshot?.live?.announcement || '—'}</p>
            <ul>
              {snapshot?.live?.tokens.map((token) => (
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
        <pre className="status">{JSON.stringify(snapshot?.live?.combat ?? {}, null, 2)}</pre>
      </aside>
    </div>
  );
}
