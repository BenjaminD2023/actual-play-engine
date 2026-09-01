import { AuthPolicyError, LivePlayError, ShowCueError } from './errors.js';
import { createId, nowIso } from './ids.js';
import { canControlShow, canTriggerPlayerAction, type CommandSource } from './auth/roles.js';
import { CommandBus } from './commands/bus.js';
import type { CommandMeta, CommandResult, EngineCommand } from './commands/types.js';
import { EngineEventBus } from './events/bus.js';
import {
  calculateCombatTurn,
  commandTypeForCombatAction,
  getCombatAction,
  isTriggeringMidiNote,
} from './live/combat.js';
import { applyHpButtonDelta } from './live/hp.js';
import {
  buildBetrayPollDraft,
  DEFAULT_POLL_COUNTDOWN_SECONDS,
  DEFAULT_POLL_RESULTS_SECONDS,
  getTimedPollLifecycleUpdate,
  normalizeCharacterPatch,
  normalizePollDraft,
  normalizePollManagementAction,
  type PollManagementAction,
} from './audience/polls.js';
import { matchKeybind, MidiDedupe } from './midi/keybinds.js';
import { getActionTarget, midiActionToCommandType, type MidiEvent } from './midi/protocol.js';
import { generateBridgeToken, hashBridgeToken, verifyBridgeToken } from './midi/token.js';
import { DryRunQLab } from './qlab/dry-run.js';
import { QLabSession } from './qlab/session.js';
import type { QLabDriver, QLabNetworkConfig } from './qlab/types.js';
import { ShowCues, type ShowCueMap } from './show/cues.js';
import { memoryStore } from './store/memory.js';
import type { EngineStore, PlayerRecord, PollOptionRecord, PollRecord } from './store/types.js';
import { VttRuntime, type VttRuntimeOptions } from './vtt/runtime.js';

export interface EngineOptions {
  store?: EngineStore;
  qlab?: QLabNetworkConfig | { dryRun: true };
  cues?: ShowCueMap;
  midiDedupeMs?: number;
  vtt?: VttRuntimeOptions;
}

export class ActualPlayEngine {
  readonly events = new EngineEventBus();
  readonly store: EngineStore;
  qlab: QLabDriver;
  readonly cues: ShowCues;
  readonly commands: CommandBus;
  readonly vtt: VttRuntime;
  private readonly midiDedupe: MidiDedupe;

  constructor(options: EngineOptions = {}) {
    this.store = options.store ?? memoryStore({ cues: options.cues, qlab: isDryRun(options.qlab) ? undefined : options.qlab });
    const stored = this.store.getConfig();
    if (options.cues) {
      this.store.setShowCues(options.cues);
    }
    if (options.qlab && !isDryRun(options.qlab)) {
      this.store.setQLabConfig(options.qlab);
    }

    this.cues = new ShowCues(options.cues ?? stored.cues);
    this.qlab = isDryRun(options.qlab)
      ? new DryRunQLab()
      : new QLabSession(options.qlab ?? stored.qlab);
    this.commands = new CommandBus(this.qlab, this.cues, this.store, this.events);
    this.midiDedupe = new MidiDedupe(options.midiDedupeMs);
    this.vtt = new VttRuntime(this, options.vtt ?? { enabled: false });
  }

  async start(): Promise<void> {
    try {
      await this.qlab.start();
    } catch (error) {
      if (this.qlab.kind === 'dry-run') throw error;
    }
    this.events.emit('qlab.health', this.qlab.health());
  }

  async applyQLabConfig(config: QLabNetworkConfig | { dryRun: true }): Promise<void> {
    await this.qlab.stop();
    if (isDryRun(config)) {
      this.qlab = new DryRunQLab();
    } else {
      this.store.setQLabConfig(config);
      this.qlab = new QLabSession(config);
    }
    this.commands.setQLabDriver(this.qlab);
    await this.qlab.start();
    this.events.emit('qlab.health', this.qlab.health());
  }

  async stop(): Promise<void> {
    await this.qlab.stop();
    this.store.close();
  }

  health() {
    return {
      qlab: { ...this.qlab.health(), kind: this.qlab.kind },
      cues: this.cues.list(),
    };
  }

  async fireShowCue(name: string, meta: CommandMeta): Promise<CommandResult> {
    this.assertShowControl(meta.source);
    return this.commands.dispatch(this.command('show.fire', meta, { name }));
  }

  async panic(meta: CommandMeta): Promise<CommandResult> {
    this.assertShowControl(meta.source);
    return this.commands.dispatch(this.command('qlab.panic', meta));
  }

  async dispatch(command: EngineCommand): Promise<CommandResult> {
    if (
      command.type.startsWith('qlab.') ||
      command.type === 'show.fire' ||
      command.type.startsWith('combat.')
    ) {
      this.assertShowControl(command.source);
    }
    const result = await this.commands.dispatch(command);
    if (command.type.startsWith('combat.')) {
      return this.executeCombat(command, result);
    }
    if (command.type === 'player.action') {
      return this.executePlayerAction(command);
    }
    return result;
  }

  async ingestMidi(event: MidiEvent, source: CommandSource = 'midi'): Promise<CommandResult | null> {
    this.events.emit('midi.event', event);

    const keybind =
      event.actionType
        ? null
        : matchKeybind(event, this.store.listMidiKeybinds());
    const actionType = event.actionType || keybind?.action_type;
    const actionData = event.actionData || keybind?.action_data || {};
    if (!actionType) return null;

    if (this.midiDedupe.shouldSkip(actionType, event.channel, event.data1)) {
      return null;
    }

    const combat = getCombatAction(actionType);
    if (combat) {
      return this.dispatch(
        this.command(commandTypeForCombatAction(combat), { source, id: createId() }, {
          cueName: combat.cueName ?? getActionTarget(actionData),
        })
      );
    }

    if (event.suppressQlab) return null;
    const type = midiActionToCommandType(actionType);
    if (!type) return null;

    const target = getActionTarget(actionData);
    return this.dispatch(
      this.command(type, { source, id: createId() }, {
        cueNumber: target,
        cueName: target,
        address: actionData.address,
        args: actionData.args,
      })
    );
  }

  isTriggeringNote(event: MidiEvent): boolean {
    return isTriggeringMidiNote(event.midiType, event.velocity, event.data2);
  }

  rotateBridgeToken(): { token: string; hash: string; createdAt: string } {
    const token = generateBridgeToken();
    const hash = hashBridgeToken(token);
    const createdAt = nowIso();
    this.store.setBridgeTokenHash(hash, createdAt);
    return { token, hash, createdAt };
  }

  verifyBridgeToken(token: string): boolean {
    const hash = this.store.getConfig().bridgeTokenHash;
    if (!hash) return false;
    return verifyBridgeToken(token, hash);
  }

  ensureSession(name?: string) {
    return this.store.getActiveSession() ?? this.store.createSession({ name });
  }

  async startCombat(cueName: string, meta: CommandMeta): Promise<CommandResult> {
    return this.dispatch(this.command('combat.start', meta, { cueName }));
  }

  updatePlayerHp(playerId: string, delta: number, expectedVersion?: number): PlayerRecord {
    const player = this.requirePlayer(playerId);
    const next = applyHpButtonDelta({
      current_hp: player.current_hp,
      max_hp: player.max_hp,
      temp_hp: player.temp_hp,
      delta,
    });
    const updated = this.store.updatePlayer(playerId, next, expectedVersion);
    this.events.emit('player.updated', updated);
    return updated;
  }

  patchPlayer(playerId: string, body: Record<string, unknown>, expectedVersion?: number): PlayerRecord {
    const player = this.requirePlayer(playerId);
    const { updates, bumpsVersion } = normalizeCharacterPatch(body, player);
    const updated = this.store.updatePlayer(
      playerId,
      bumpsVersion ? { ...updates, version: player.version + 1 } : updates,
      expectedVersion
    );
    this.events.emit('player.updated', updated);
    return updated;
  }

  openPoll(input: {
    question: unknown;
    options: unknown;
    countdownEnabled?: unknown;
    betray?: boolean;
  }): PollRecord {
    const session = this.ensureSession();
    const draft = input.betray ? buildBetrayPollDraft() : normalizePollDraft(input.question, input.options, input.countdownEnabled);
    const poll: PollRecord = {
      id: createId(),
      session_id: session.id,
      question: draft.question,
      is_active: true,
      show_results: false,
      countdown_enabled: draft.countdown_enabled,
      countdown_duration_seconds: DEFAULT_POLL_COUNTDOWN_SECONDS,
      results_duration_seconds: DEFAULT_POLL_RESULTS_SECONDS,
      results_shown_at: null,
      poll_type: input.betray ? 'betray' : 'standard',
      display_visibility: input.betray ? 'audience_only' : 'public',
      total_votes: 0,
      created_at: nowIso(),
      ended_at: null,
    };
    const options: PollOptionRecord[] = draft.options.map((option_text, option_order) => ({
      id: createId(),
      poll_id: poll.id,
      option_text,
      option_order,
      vote_count: 0,
    }));
    const created = this.store.createPoll(poll, options);
    this.events.emit('poll.updated', created);
    return created;
  }

  vote(pollId: string, optionId: string, fingerprint: string): PollOptionRecord {
    const option = this.store.addVote(pollId, optionId, fingerprint);
    const poll = this.store.getPoll(pollId);
    if (poll) this.events.emit('poll.updated', poll);
    return option;
  }

  managePoll(pollId: string, action: unknown): PollRecord {
    const poll = this.store.getPoll(pollId);
    if (!poll) throw new LivePlayError('not_found', 'Poll was not found.');
    const normalized: PollManagementAction = normalizePollManagementAction(action);
    const now = nowIso();
    let patch: Partial<PollRecord> = {};
    if (normalized === 'show_results') patch = { show_results: true, results_shown_at: now };
    if (normalized === 'close' || normalized === 'dismiss' || normalized === 'delete') {
      patch = { is_active: false, show_results: false, ended_at: now };
    }
    const updated = this.store.updatePoll(pollId, patch);
    this.events.emit('poll.updated', updated);
    return updated;
  }

  tickPolls(now = new Date()): void {
    const session = this.store.getActiveSession();
    if (!session) return;
    for (const poll of this.store.listPolls(session.id)) {
      const update = getTimedPollLifecycleUpdate(poll, now);
      if (!update) continue;
      this.store.updatePoll(poll.id, {
        is_active: update.is_active === 0 ? false : poll.is_active,
        show_results: update.show_results === 1 ? true : update.show_results === 0 ? false : poll.show_results,
        results_shown_at: update.results_shown_at ?? poll.results_shown_at,
        ended_at: update.ended_at ?? poll.ended_at,
      });
    }
  }

  private async executeCombat(command: EngineCommand, prior: CommandResult): Promise<CommandResult> {
    const session = this.ensureSession();
    const state = this.store.getGameState(session.id);

    switch (command.type) {
      case 'combat.build_order': {
        const players = this.store.listPlayers(session.id).filter((player) => player.is_active);
        if (players.length === 0) {
          return { ...prior, skipped: 'No active party members are available.' };
        }
        this.store.closeInitiativePrompts(session.id);
        this.store.replaceInitiative(
          session.id,
          players.map((player, sort_order) => ({
            id: createId(),
            session_id: session.id,
            participant_id: player.id,
            participant_type: 'player' as const,
            participant_name: player.character_name,
            initiative_result: 0,
            initiative_modifier: 0,
            initiative_total: 0,
            sort_order,
            is_ready: false,
            is_boss: false,
            boss_damage_taken: 0,
          }))
        );
        this.store.setInitiativePrompt({
          id: createId(),
          session_id: session.id,
          is_active: true,
          show_results: false,
          created_at: nowIso(),
          ended_at: null,
        });
        this.store.updateGameState(session.id, { combat_mode: true, current_turn: 0 });
        this.events.emit('combat.updated', this.store.getGameState(session.id));
        return { ...prior, ok: true, status: 'ok' };
      }
      case 'combat.start': {
        const prompt = this.store.getActiveInitiativePrompt(session.id);
        if (!prompt) {
          return { ...prior, skipped: 'No combat preparation is active.', ok: true, status: 'skipped' };
        }
        const cueName = String(command.payload?.cueName ?? 'combat.battle-1');
        this.store.updateGameState(session.id, { combat_mode: true, current_turn: 0, round_number: 1 });
        this.events.emit('combat.updated', this.store.getGameState(session.id));
        try {
          const fire = await this.commands.dispatch(
            this.command('show.fire', { source: command.source, actorId: command.actorId, id: createId() }, { name: cueName })
          );
          return { ...fire, type: command.type, cueName };
        } catch (error) {
          if (error instanceof ShowCueError) {
            return { ...prior, ok: false, status: 'error', error: error.message, cueName };
          }
          throw error;
        }
      }
      case 'combat.end':
      case 'combat.dismiss_prep':
        this.store.closeInitiativePrompts(session.id);
        this.store.updateGameState(session.id, { combat_mode: false, current_turn: 0 });
        this.events.emit('combat.updated', this.store.getGameState(session.id));
        return { ...prior, ok: true, status: 'ok' };
      case 'combat.next_turn':
      case 'combat.previous_turn': {
        const participants = this.store.listInitiative(session.id);
        const next = calculateCombatTurn({
          direction: command.type === 'combat.next_turn' ? 'forward' : 'backward',
          currentTurn: state.current_turn,
          roundNumber: state.round_number,
          participantCount: participants.length,
        });
        this.store.updateGameState(session.id, next);
        this.events.emit('combat.updated', this.store.getGameState(session.id));
        return { ...prior, ok: true, status: 'ok' };
      }
      case 'combat.new_round':
        this.store.updateGameState(session.id, { current_turn: 0, round_number: state.round_number + 1 });
        this.events.emit('combat.updated', this.store.getGameState(session.id));
        return { ...prior, ok: true, status: 'ok' };
      case 'combat.reset_counter':
        this.store.updateGameState(session.id, { current_turn: 0, round_number: 1 });
        this.events.emit('combat.updated', this.store.getGameState(session.id));
        return { ...prior, ok: true, status: 'ok' };
      default:
        return prior;
    }
  }

  private async executePlayerAction(command: EngineCommand): Promise<CommandResult> {
    if (!canTriggerPlayerAction(command.source)) {
      throw new AuthPolicyError('forbidden', 'This role cannot trigger player actions.');
    }
    const actionId = String(command.payload?.actionId ?? '');
    const action = this.store.getPlayerAction(actionId);
    if (!action || !action.is_enabled) {
      throw new LivePlayError('not_found', 'Action is not available.');
    }
    const nameOrNumber = action.cue_name || action.cue_number;
    if (!nameOrNumber) {
      throw new ShowCueError('missing_cue', 'This action does not have a QLab cue assigned.');
    }
    if (this.cues.has(nameOrNumber)) {
      return this.commands.dispatch(this.command('show.fire', command, { name: nameOrNumber }));
    }
    return this.commands.dispatch(this.command('qlab.start', command, { cueNumber: nameOrNumber }));
  }

  private command(type: EngineCommand['type'], meta: CommandMeta, payload?: Record<string, unknown>): EngineCommand {
    return {
      id: meta.id ?? createId(),
      type,
      source: meta.source,
      actorId: meta.actorId ?? null,
      payload,
    };
  }

  private assertShowControl(source: CommandSource): void {
    if (!canControlShow(source)) {
      throw new AuthPolicyError('forbidden', 'This role cannot control the theatre.');
    }
  }

  private requirePlayer(id: string): PlayerRecord {
    const player = this.store.getPlayer(id);
    if (!player) throw new LivePlayError('not_found', `Player ${id} was not found.`);
    return player;
  }
}

export function createEngine(options: EngineOptions = {}): ActualPlayEngine {
  return new ActualPlayEngine(options);
}

function isDryRun(qlab: EngineOptions['qlab']): qlab is { dryRun: true } {
  return Boolean(qlab && 'dryRun' in qlab && qlab.dryRun);
}
