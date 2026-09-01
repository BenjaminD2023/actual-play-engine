import { LivePlayError } from '../errors.js';
import { createId, nowIso } from '../ids.js';
import { parseActionData, type MidiKeybind } from '../midi/protocol.js';
import { normalizeShowCueMap } from '../show/cues.js';
import type {
  AuthUserRecord,
  EngineConfig,
  EngineStore,
  GameStateRecord,
  InitiativePromptRecord,
  InitiativeRecord,
  PlayerActionRecord,
  PlayerRecord,
  PollOptionRecord,
  PollRecord,
  SessionRecord,
  VirtualButtonRecord,
} from './types.js';
import type { FireLogEntry } from '../commands/types.js';
import type { QLabNetworkConfig } from '../qlab/types.js';
import type { ShowCueMap } from '../show/cues.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore implements EngineStore {
  private config: EngineConfig;
  private fireLog: FireLogEntry[] = [];
  private users = new Map<string, AuthUserRecord>();
  private sessions = new Map<string, SessionRecord>();
  private gameState = new Map<string, GameStateRecord>();
  private players = new Map<string, PlayerRecord>();
  private initiatives = new Map<string, InitiativeRecord[]>();
  private initiativePrompts = new Map<string, InitiativePromptRecord[]>();
  private playerActions = new Map<string, PlayerActionRecord>();
  private virtualButtons = new Map<string, VirtualButtonRecord>();
  private midiKeybinds: MidiKeybind[] = [];
  private polls = new Map<string, PollRecord>();
  private pollOptions = new Map<string, PollOptionRecord[]>();
  private votes = new Set<string>();

  constructor(seed: Partial<EngineConfig> = {}) {
    this.config = {
      qlab: seed.qlab ?? { host: '127.0.0.1', port: 53000 },
      cues: normalizeShowCueMap(seed.cues),
      midiEnabled: seed.midiEnabled ?? true,
      bridgeTokenHash: seed.bridgeTokenHash ?? null,
      bridgeTokenCreatedAt: seed.bridgeTokenCreatedAt ?? null,
    };
  }

  getConfig(): EngineConfig {
    return clone(this.config);
  }

  setQLabConfig(config: QLabNetworkConfig): void {
    this.config.qlab = { ...config };
  }

  setShowCues(cues: ShowCueMap): void {
    this.config.cues = normalizeShowCueMap(cues);
  }

  setBridgeTokenHash(hash: string, createdAt: string): void {
    this.config.bridgeTokenHash = hash;
    this.config.bridgeTokenCreatedAt = createdAt;
  }

  appendFireLog(entry: FireLogEntry): void {
    this.fireLog.unshift(entry);
  }

  listFireLog(limit = 100): FireLogEntry[] {
    return this.fireLog.slice(0, limit).map(clone);
  }

  getUserByUsername(username: string): AuthUserRecord | null {
    return [...this.users.values()].find((user) => user.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  getUserById(id: string): AuthUserRecord | null {
    return this.users.get(id) ?? null;
  }

  listUsers(): AuthUserRecord[] {
    return [...this.users.values()].map(clone);
  }

  createUser(user: AuthUserRecord): AuthUserRecord {
    this.users.set(user.id, clone(user));
    return clone(user);
  }

  updateUser(id: string, patch: Partial<AuthUserRecord>): AuthUserRecord {
    const current = this.users.get(id);
    if (!current) throw new LivePlayError('not_found', `User ${id} was not found.`);
    const next = { ...current, ...patch, id, updated_at: nowIso() };
    this.users.set(id, next);
    return clone(next);
  }

  getActiveSession(): SessionRecord | null {
    return [...this.sessions.values()].find((session) => session.is_active) ?? null;
  }

  createSession(input: { campaignId?: string; name?: string }): SessionRecord {
    this.endActiveSessions();
    const session: SessionRecord = {
      id: createId(),
      campaign_id: input.campaignId ?? 'default',
      session_name: input.name ?? 'Session',
      session_number: this.sessions.size + 1,
      is_active: true,
      started_at: nowIso(),
      ended_at: null,
    };
    this.sessions.set(session.id, session);
    this.getGameState(session.id);
    return clone(session);
  }

  endActiveSessions(): void {
    for (const session of this.sessions.values()) {
      if (session.is_active) {
        session.is_active = false;
        session.ended_at = nowIso();
      }
    }
  }

  getGameState(sessionId: string): GameStateRecord {
    const existing = this.gameState.get(sessionId);
    if (existing) return clone(existing);
    const created: GameStateRecord = {
      session_id: sessionId,
      version: 1,
      current_turn: 0,
      round_number: 1,
      combat_mode: false,
      global_announcement: '',
      camera_visible: false,
      updated_at: nowIso(),
    };
    this.gameState.set(sessionId, created);
    return clone(created);
  }

  updateGameState(sessionId: string, patch: Partial<GameStateRecord>): GameStateRecord {
    const current = this.getGameState(sessionId);
    const next = { ...current, ...patch, session_id: sessionId, updated_at: nowIso() };
    this.gameState.set(sessionId, next);
    return clone(next);
  }

  listPlayers(sessionId: string): PlayerRecord[] {
    return [...this.players.values()].filter((player) => player.session_id === sessionId).map(clone);
  }

  getPlayer(id: string): PlayerRecord | null {
    return this.players.get(id) ?? null;
  }

  getPlayerByAuthUserId(authUserId: string, sessionId: string): PlayerRecord | null {
    return (
      [...this.players.values()].find(
        (player) => player.auth_user_id === authUserId && player.session_id === sessionId && player.is_active
      ) ?? null
    );
  }

  createPlayer(player: PlayerRecord): PlayerRecord {
    this.players.set(player.id, clone(player));
    return clone(player);
  }

  updatePlayer(id: string, patch: Partial<PlayerRecord>, expectedVersion?: number): PlayerRecord {
    const current = this.players.get(id);
    if (!current) throw new LivePlayError('not_found', `Player ${id} was not found.`);
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new LivePlayError('version_conflict', 'Player state changed; reload and try again.');
    }
    const next = {
      ...current,
      ...patch,
      id,
      version: patch.version ?? current.version + (patch.current_hp !== undefined || patch.max_hp !== undefined ? 1 : 0),
      updated_at: nowIso(),
    };
    this.players.set(id, next);
    return clone(next);
  }

  listInitiative(sessionId: string): InitiativeRecord[] {
    return (this.initiatives.get(sessionId) ?? []).map(clone);
  }

  replaceInitiative(sessionId: string, rows: InitiativeRecord[]): void {
    this.initiatives.set(sessionId, rows.map(clone));
  }

  getActiveInitiativePrompt(sessionId: string): InitiativePromptRecord | null {
    return (this.initiativePrompts.get(sessionId) ?? []).find((prompt) => prompt.is_active) ?? null;
  }

  setInitiativePrompt(prompt: InitiativePromptRecord): void {
    const list = this.initiativePrompts.get(prompt.session_id) ?? [];
    this.initiativePrompts.set(prompt.session_id, [...list.filter((item) => item.id !== prompt.id), clone(prompt)]);
  }

  closeInitiativePrompts(sessionId: string): void {
    const list = this.initiativePrompts.get(sessionId) ?? [];
    this.initiativePrompts.set(
      sessionId,
      list.map((prompt) => ({ ...prompt, is_active: false, ended_at: prompt.ended_at ?? nowIso() }))
    );
  }

  listPlayerActions(playerId: string): PlayerActionRecord[] {
    return [...this.playerActions.values()].filter((action) => action.player_id === playerId).map(clone);
  }

  getPlayerAction(id: string): PlayerActionRecord | null {
    return this.playerActions.get(id) ?? null;
  }

  upsertPlayerAction(action: PlayerActionRecord): PlayerActionRecord {
    this.playerActions.set(action.id, clone(action));
    return clone(action);
  }

  listVirtualButtons(): VirtualButtonRecord[] {
    return [...this.virtualButtons.values()].map(clone);
  }

  upsertVirtualButton(button: VirtualButtonRecord): VirtualButtonRecord {
    this.virtualButtons.set(button.id, clone(button));
    return clone(button);
  }

  deleteVirtualButton(id: string): void {
    this.virtualButtons.delete(id);
  }

  listMidiKeybinds(): MidiKeybind[] {
    return this.midiKeybinds.map(clone);
  }

  replaceMidiKeybinds(binds: MidiKeybind[]): void {
    this.midiKeybinds = binds.map(clone);
  }

  listPolls(sessionId: string): PollRecord[] {
    return [...this.polls.values()].filter((poll) => poll.session_id === sessionId).map(clone);
  }

  getPoll(id: string): PollRecord | null {
    return this.polls.get(id) ?? null;
  }

  createPoll(poll: PollRecord, options: PollOptionRecord[]): PollRecord {
    this.polls.set(poll.id, clone(poll));
    this.pollOptions.set(poll.id, options.map(clone));
    return clone(poll);
  }

  updatePoll(id: string, patch: Partial<PollRecord>): PollRecord {
    const current = this.polls.get(id);
    if (!current) throw new LivePlayError('not_found', `Poll ${id} was not found.`);
    const next = { ...current, ...patch, id };
    this.polls.set(id, next);
    return clone(next);
  }

  listPollOptions(pollId: string): PollOptionRecord[] {
    return (this.pollOptions.get(pollId) ?? []).map(clone);
  }

  addVote(pollId: string, optionId: string, fingerprint: string): PollOptionRecord {
    const key = `${pollId}:${fingerprint}`;
    if (this.votes.has(key)) {
      throw new LivePlayError('already_voted', 'This device has already voted.');
    }
    const options = this.pollOptions.get(pollId) ?? [];
    const option = options.find((item) => item.id === optionId);
    if (!option) throw new LivePlayError('not_found', 'Poll option was not found.');
    option.vote_count += 1;
    this.votes.add(key);
    const poll = this.polls.get(pollId);
    if (poll) poll.total_votes += 1;
    return clone(option);
  }

  close(): void {
    // no-op
  }
}

export function memoryStore(seed?: Partial<EngineConfig>): MemoryStore {
  return new MemoryStore(seed);
}

export { parseActionData };
