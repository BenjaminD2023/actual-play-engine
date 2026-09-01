import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LivePlayError } from '../errors.js';
import { createId, nowIso } from '../ids.js';
import { parseActionData, type MidiKeybind } from '../midi/protocol.js';
import { normalizeShowCueMap, type ShowCueMap } from '../show/cues.js';
import { ENGINE_SCHEMA } from './schema.js';
import { runMigrations } from './migrations.js';
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
import type { CommandSource } from '../auth/roles.js';
import type { PollDisplayVisibility, PollType } from '../audience/polls.js';

function bool(value: unknown): boolean {
  return Boolean(value) && value !== 0;
}

export class SqliteStore implements EngineStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(ENGINE_SCHEMA);
    runMigrations(this.db);
  }

  get database(): Database.Database {
    return this.db;
  }

  getConfig(): EngineConfig {
    const row = this.db.prepare(`SELECT * FROM app_config WHERE id = 'default'`).get() as {
      qlab_host: string;
      qlab_port: number;
      qlab_workspace_id: string | null;
      qlab_passcode: string | null;
      show_cues: string;
      midi_enabled: number;
      bridge_token_hash: string | null;
      bridge_token_created_at: string | null;
    };
    let cues: ShowCueMap = {};
    try {
      cues = normalizeShowCueMap(JSON.parse(row.show_cues || '{}') as ShowCueMap);
    } catch {
      cues = {};
    }
    return {
      qlab: {
        host: row.qlab_host || '127.0.0.1',
        port: row.qlab_port || 53000,
        workspaceId: row.qlab_workspace_id,
        passcode: row.qlab_passcode,
      },
      cues,
      midiEnabled: bool(row.midi_enabled),
      bridgeTokenHash: row.bridge_token_hash,
      bridgeTokenCreatedAt: row.bridge_token_created_at,
    };
  }

  setQLabConfig(config: QLabNetworkConfig): void {
    this.db
      .prepare(
        `UPDATE app_config
         SET qlab_host = ?, qlab_port = ?, qlab_workspace_id = ?, qlab_passcode = ?, updated_at = ?
         WHERE id = 'default'`
      )
      .run(config.host, config.port, config.workspaceId ?? null, config.passcode ?? null, nowIso());
  }

  setShowCues(cues: ShowCueMap): void {
    this.db
      .prepare(`UPDATE app_config SET show_cues = ?, updated_at = ? WHERE id = 'default'`)
      .run(JSON.stringify(normalizeShowCueMap(cues)), nowIso());
  }

  setBridgeTokenHash(hash: string, createdAt: string): void {
    this.db
      .prepare(
        `UPDATE app_config SET bridge_token_hash = ?, bridge_token_created_at = ?, updated_at = ? WHERE id = 'default'`
      )
      .run(hash, createdAt, nowIso());
  }

  appendFireLog(entry: FireLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO fire_log (
          id, at, command_id, type, source, actor_id, cue_name, cue_number, address, status, confirmed, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.at,
        entry.commandId,
        entry.type,
        entry.source,
        entry.actorId,
        entry.cueName,
        entry.cueNumber,
        entry.address,
        entry.status,
        entry.confirmed ? 1 : 0,
        entry.error
      );
  }

  listFireLog(limit = 100): FireLogEntry[] {
    const rows = this.db
      .prepare(`SELECT * FROM fire_log ORDER BY at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      at: String(row.at),
      commandId: String(row.command_id),
      type: String(row.type),
      source: row.source as CommandSource,
      actorId: (row.actor_id as string | null) ?? null,
      cueName: (row.cue_name as string | null) ?? null,
      cueNumber: (row.cue_number as string | null) ?? null,
      address: (row.address as string | null) ?? null,
      status: row.status as FireLogEntry['status'],
      confirmed: bool(row.confirmed),
      error: (row.error as string | null) ?? null,
    }));
  }

  getUserByUsername(username: string): AuthUserRecord | null {
    return (this.db.prepare(`SELECT * FROM auth_users WHERE lower(username) = lower(?)`).get(username) as AuthUserRecord | undefined) ?? null;
  }

  getUserById(id: string): AuthUserRecord | null {
    return (this.db.prepare(`SELECT * FROM auth_users WHERE id = ?`).get(id) as AuthUserRecord | undefined) ?? null;
  }

  listUsers(): AuthUserRecord[] {
    return this.db.prepare(`SELECT * FROM auth_users ORDER BY username`).all() as AuthUserRecord[];
  }

  createUser(user: AuthUserRecord): AuthUserRecord {
    this.db
      .prepare(
        `INSERT INTO auth_users (id, first_name, last_name, username, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        user.first_name,
        user.last_name,
        user.username,
        user.email,
        user.role,
        user.password_hash,
        user.created_at,
        user.updated_at
      );
    return user;
  }

  updateUser(id: string, patch: Partial<AuthUserRecord>): AuthUserRecord {
    const current = this.getUserById(id);
    if (!current) throw new LivePlayError('not_found', `User ${id} was not found.`);
    const next = { ...current, ...patch, id, updated_at: nowIso() };
    this.db
      .prepare(
        `UPDATE auth_users
         SET first_name = ?, last_name = ?, username = ?, email = ?, role = ?, password_hash = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.first_name, next.last_name, next.username, next.email, next.role, next.password_hash, next.updated_at, id);
    return next;
  }

  getActiveSession(): SessionRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM game_sessions WHERE is_active = 1 ORDER BY started_at DESC LIMIT 1`)
      .get() as
      | {
          id: string;
          campaign_id: string;
          session_name: string;
          session_number: number;
          is_active: number;
          started_at: string;
          ended_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      campaign_id: row.campaign_id,
      session_name: row.session_name,
      session_number: row.session_number,
      is_active: bool(row.is_active),
      started_at: row.started_at,
      ended_at: row.ended_at,
    };
  }

  createSession(input: { campaignId?: string; name?: string }): SessionRecord {
    this.endActiveSessions();
    const count = (this.db.prepare(`SELECT count(*) as c FROM game_sessions`).get() as { c: number }).c;
    const session: SessionRecord = {
      id: createId(),
      campaign_id: input.campaignId ?? 'default',
      session_name: input.name ?? 'Session',
      session_number: count + 1,
      is_active: true,
      started_at: nowIso(),
      ended_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO game_sessions (id, campaign_id, session_name, session_number, is_active, started_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      )
      .run(session.id, session.campaign_id, session.session_name, session.session_number, session.started_at);
    this.getGameState(session.id);
    return session;
  }

  endActiveSessions(): void {
    this.db
      .prepare(
        `UPDATE game_sessions SET is_active = 0, ended_at = coalesce(ended_at, ?) WHERE is_active = 1`
      )
      .run(nowIso());
  }

  getGameState(sessionId: string): GameStateRecord {
    const row = this.db.prepare(`SELECT * FROM game_state WHERE session_id = ?`).get(sessionId) as
      | Record<string, unknown>
      | undefined;
    if (row) {
      return this.mapGameState(row);
    }
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
    this.db
      .prepare(
        `INSERT INTO game_state (session_id, version, current_turn, round_number, combat_mode, global_announcement, camera_visible, updated_at)
         VALUES (?, 1, 0, 1, 0, '', 0, ?)`
      )
      .run(sessionId, created.updated_at);
    return created;
  }

  updateGameState(sessionId: string, patch: Partial<GameStateRecord>): GameStateRecord {
    const current = this.getGameState(sessionId);
    const next = { ...current, ...patch, session_id: sessionId, updated_at: nowIso() };
    this.db
      .prepare(
        `UPDATE game_state
         SET version = ?, current_turn = ?, round_number = ?, combat_mode = ?, global_announcement = ?, camera_visible = ?, updated_at = ?
         WHERE session_id = ?`
      )
      .run(
        next.version,
        next.current_turn,
        next.round_number,
        next.combat_mode ? 1 : 0,
        next.global_announcement,
        next.camera_visible ? 1 : 0,
        next.updated_at,
        sessionId
      );
    return next;
  }

  listPlayers(sessionId: string): PlayerRecord[] {
    const rows = this.db.prepare(`SELECT * FROM players WHERE session_id = ?`).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapPlayer(row));
  }

  getPlayer(id: string): PlayerRecord | null {
    const row = this.db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPlayer(row) : null;
  }

  getPlayerByAuthUserId(authUserId: string, sessionId: string): PlayerRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM players WHERE auth_user_id = ? AND session_id = ? AND is_active = 1`)
      .get(authUserId, sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapPlayer(row) : null;
  }

  createPlayer(player: PlayerRecord): PlayerRecord {
    this.db
      .prepare(
        `INSERT INTO players (
          id, auth_user_id, session_id, character_name, character_class, character_level,
          armor_class, current_hp, max_hp, temp_hp, version,
          spell_slots_level_1, spell_slots_level_2, spell_slots_level_3, spell_slots_level_4,
          spell_slots_level_5, spell_slots_level_6, spell_slots_level_7, spell_slots_level_8, spell_slots_level_9,
          inspiration_tokens, portrait_url, audience_tags, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        player.id,
        player.auth_user_id,
        player.session_id,
        player.character_name,
        player.character_class,
        player.character_level,
        player.armor_class,
        player.current_hp,
        player.max_hp,
        player.temp_hp,
        player.version,
        player.spell_slots_level_1,
        player.spell_slots_level_2,
        player.spell_slots_level_3,
        player.spell_slots_level_4,
        player.spell_slots_level_5,
        player.spell_slots_level_6,
        player.spell_slots_level_7,
        player.spell_slots_level_8,
        player.spell_slots_level_9,
        player.inspiration_tokens,
        player.portrait_url,
        player.audience_tags,
        player.is_active ? 1 : 0,
        player.created_at,
        player.updated_at
      );
    return player;
  }

  updatePlayer(id: string, patch: Partial<PlayerRecord>, expectedVersion?: number): PlayerRecord {
    const current = this.getPlayer(id);
    if (!current) throw new LivePlayError('not_found', `Player ${id} was not found.`);
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new LivePlayError('version_conflict', 'Player state changed; reload and try again.');
    }
    const next = { ...current, ...patch, id, updated_at: nowIso() };
    if (patch.current_hp !== undefined || patch.max_hp !== undefined || patch.temp_hp !== undefined) {
      next.version = current.version + 1;
    }
    this.db
      .prepare(
        `UPDATE players SET
          character_name = ?, armor_class = ?, current_hp = ?, max_hp = ?, temp_hp = ?, version = ?,
          spell_slots_level_1 = ?, spell_slots_level_2 = ?, spell_slots_level_3 = ?, spell_slots_level_4 = ?,
          spell_slots_level_5 = ?, spell_slots_level_6 = ?, spell_slots_level_7 = ?, spell_slots_level_8 = ?, spell_slots_level_9 = ?,
          inspiration_tokens = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.character_name,
        next.armor_class,
        next.current_hp,
        next.max_hp,
        next.temp_hp,
        next.version,
        next.spell_slots_level_1,
        next.spell_slots_level_2,
        next.spell_slots_level_3,
        next.spell_slots_level_4,
        next.spell_slots_level_5,
        next.spell_slots_level_6,
        next.spell_slots_level_7,
        next.spell_slots_level_8,
        next.spell_slots_level_9,
        next.inspiration_tokens,
        next.is_active ? 1 : 0,
        next.updated_at,
        id
      );
    return next;
  }

  listInitiative(sessionId: string): InitiativeRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM initiatives WHERE session_id = ? ORDER BY sort_order ASC`)
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      session_id: String(row.session_id),
      participant_id: String(row.participant_id),
      participant_type: row.participant_type === 'enemy' ? 'enemy' : 'player',
      participant_name: String(row.participant_name),
      initiative_result: Number(row.initiative_result),
      initiative_modifier: Number(row.initiative_modifier),
      initiative_total: Number(row.initiative_total),
      sort_order: Number(row.sort_order),
      is_ready: bool(row.is_ready),
      is_boss: bool(row.is_boss),
      boss_damage_taken: Number(row.boss_damage_taken),
    }));
  }

  replaceInitiative(sessionId: string, rows: InitiativeRecord[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM initiatives WHERE session_id = ?`).run(sessionId);
      const insert = this.db.prepare(
        `INSERT INTO initiatives (
          id, session_id, participant_id, participant_type, participant_name,
          initiative_result, initiative_modifier, initiative_total, sort_order, is_ready, is_boss, boss_damage_taken
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        insert.run(
          row.id,
          sessionId,
          row.participant_id,
          row.participant_type,
          row.participant_name,
          row.initiative_result,
          row.initiative_modifier,
          row.initiative_total,
          row.sort_order,
          row.is_ready ? 1 : 0,
          row.is_boss ? 1 : 0,
          row.boss_damage_taken
        );
      }
    });
    tx();
  }

  getActiveInitiativePrompt(sessionId: string): InitiativePromptRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM initiative_prompts WHERE session_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      session_id: String(row.session_id),
      is_active: bool(row.is_active),
      show_results: bool(row.show_results),
      created_at: String(row.created_at),
      ended_at: (row.ended_at as string | null) ?? null,
    };
  }

  setInitiativePrompt(prompt: InitiativePromptRecord): void {
    this.db
      .prepare(
        `INSERT INTO initiative_prompts (id, session_id, is_active, show_results, created_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET is_active = excluded.is_active, show_results = excluded.show_results, ended_at = excluded.ended_at`
      )
      .run(
        prompt.id,
        prompt.session_id,
        prompt.is_active ? 1 : 0,
        prompt.show_results ? 1 : 0,
        prompt.created_at,
        prompt.ended_at
      );
  }

  closeInitiativePrompts(sessionId: string): void {
    this.db
      .prepare(
        `UPDATE initiative_prompts SET is_active = 0, ended_at = coalesce(ended_at, ?) WHERE session_id = ? AND is_active = 1`
      )
      .run(nowIso(), sessionId);
  }

  listPlayerActions(playerId: string): PlayerActionRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM player_actions WHERE player_id = ? ORDER BY sort_order ASC`)
      .all(playerId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      player_id: String(row.player_id),
      label: String(row.label),
      description: String(row.description ?? ''),
      cue_name: String(row.cue_name ?? ''),
      cue_number: String(row.cue_number ?? ''),
      sort_order: Number(row.sort_order),
      is_enabled: bool(row.is_enabled),
    }));
  }

  getPlayerAction(id: string): PlayerActionRecord | null {
    const row = this.db.prepare(`SELECT * FROM player_actions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      player_id: String(row.player_id),
      label: String(row.label),
      description: String(row.description ?? ''),
      cue_name: String(row.cue_name ?? ''),
      cue_number: String(row.cue_number ?? ''),
      sort_order: Number(row.sort_order),
      is_enabled: bool(row.is_enabled),
    };
  }

  upsertPlayerAction(action: PlayerActionRecord): PlayerActionRecord {
    this.db
      .prepare(
        `INSERT INTO player_actions (id, player_id, label, description, cue_name, cue_number, sort_order, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label, description = excluded.description, cue_name = excluded.cue_name,
           cue_number = excluded.cue_number, sort_order = excluded.sort_order, is_enabled = excluded.is_enabled`
      )
      .run(
        action.id,
        action.player_id,
        action.label,
        action.description,
        action.cue_name,
        action.cue_number,
        action.sort_order,
        action.is_enabled ? 1 : 0
      );
    return action;
  }

  listVirtualButtons(): VirtualButtonRecord[] {
    const rows = this.db.prepare(`SELECT * FROM virtual_buttons ORDER BY position`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      position: Number(row.position),
      label: String(row.label),
      color: String(row.color),
      action_type: String(row.action_type),
      action_data: parseActionData(String(row.action_data)),
      key_bind: String(row.key_bind ?? ''),
      is_active: bool(row.is_active),
    }));
  }

  upsertVirtualButton(button: VirtualButtonRecord): VirtualButtonRecord {
    this.db
      .prepare(
        `INSERT INTO virtual_buttons (id, position, label, color, action_type, action_data, key_bind, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           position = excluded.position, label = excluded.label, color = excluded.color,
           action_type = excluded.action_type, action_data = excluded.action_data,
           key_bind = excluded.key_bind, is_active = excluded.is_active`
      )
      .run(
        button.id,
        button.position,
        button.label,
        button.color,
        button.action_type,
        JSON.stringify(button.action_data),
        button.key_bind,
        button.is_active ? 1 : 0
      );
    return button;
  }

  deleteVirtualButton(id: string): void {
    this.db.prepare(`DELETE FROM virtual_buttons WHERE id = ?`).run(id);
  }

  listMidiKeybinds(): MidiKeybind[] {
    const rows = this.db.prepare(`SELECT * FROM midi_keybinds`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      midi_type: String(row.midi_type),
      midi_channel: Number(row.midi_channel),
      midi_data1: Number(row.midi_data1),
      midi_data2: Number(row.midi_data2),
      action_type: String(row.action_type),
      action_data: parseActionData(String(row.action_data)),
      label: String(row.label ?? ''),
      is_active: bool(row.is_active),
    }));
  }

  replaceMidiKeybinds(binds: MidiKeybind[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM midi_keybinds`).run();
      const insert = this.db.prepare(
        `INSERT INTO midi_keybinds (id, midi_type, midi_channel, midi_data1, midi_data2, action_type, action_data, label, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const bind of binds) {
        insert.run(
          bind.id,
          bind.midi_type,
          bind.midi_channel,
          bind.midi_data1,
          bind.midi_data2,
          bind.action_type,
          JSON.stringify(bind.action_data),
          bind.label,
          bind.is_active ? 1 : 0
        );
      }
    });
    tx();
  }

  listPolls(sessionId: string): PollRecord[] {
    const rows = this.db.prepare(`SELECT * FROM polls WHERE session_id = ?`).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapPoll(row));
  }

  getPoll(id: string): PollRecord | null {
    const row = this.db.prepare(`SELECT * FROM polls WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.mapPoll(row) : null;
  }

  createPoll(poll: PollRecord, options: PollOptionRecord[]): PollRecord {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO polls (
            id, session_id, question, is_active, show_results, countdown_enabled,
            countdown_duration_seconds, results_duration_seconds, results_shown_at,
            poll_type, display_visibility, total_votes, created_at, ended_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          poll.id,
          poll.session_id,
          poll.question,
          poll.is_active ? 1 : 0,
          poll.show_results ? 1 : 0,
          poll.countdown_enabled ? 1 : 0,
          poll.countdown_duration_seconds,
          poll.results_duration_seconds,
          poll.results_shown_at,
          poll.poll_type,
          poll.display_visibility,
          poll.total_votes,
          poll.created_at,
          poll.ended_at
        );
      const insert = this.db.prepare(
        `INSERT INTO poll_options (id, poll_id, option_text, option_order, vote_count) VALUES (?, ?, ?, ?, ?)`
      );
      for (const option of options) {
        insert.run(option.id, poll.id, option.option_text, option.option_order, option.vote_count);
      }
    });
    tx();
    return poll;
  }

  updatePoll(id: string, patch: Partial<PollRecord>): PollRecord {
    const current = this.getPoll(id);
    if (!current) throw new LivePlayError('not_found', `Poll ${id} was not found.`);
    const next = { ...current, ...patch, id };
    this.db
      .prepare(
        `UPDATE polls SET
          question = ?, is_active = ?, show_results = ?, countdown_enabled = ?,
          results_shown_at = ?, total_votes = ?, ended_at = ?
         WHERE id = ?`
      )
      .run(
        next.question,
        next.is_active ? 1 : 0,
        next.show_results ? 1 : 0,
        next.countdown_enabled ? 1 : 0,
        next.results_shown_at,
        next.total_votes,
        next.ended_at,
        id
      );
    return next;
  }

  listPollOptions(pollId: string): PollOptionRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM poll_options WHERE poll_id = ? ORDER BY option_order`)
      .all(pollId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      poll_id: String(row.poll_id),
      option_text: String(row.option_text),
      option_order: Number(row.option_order),
      vote_count: Number(row.vote_count),
    }));
  }

  addVote(pollId: string, optionId: string, fingerprint: string): PollOptionRecord {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO votes (poll_id, option_id, fingerprint, created_at) VALUES (?, ?, ?, ?)`)
        .run(pollId, optionId, fingerprint, nowIso());
      this.db.prepare(`UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = ?`).run(optionId);
      this.db.prepare(`UPDATE polls SET total_votes = total_votes + 1 WHERE id = ?`).run(pollId);
    });
    try {
      tx();
    } catch (error) {
      if (error instanceof Error && /UNIQUE/.test(error.message)) {
        throw new LivePlayError('already_voted', 'This device has already voted.');
      }
      throw error;
    }
    const option = this.listPollOptions(pollId).find((item) => item.id === optionId);
    if (!option) throw new LivePlayError('not_found', 'Poll option was not found.');
    return option;
  }

  close(): void {
    this.db.close();
  }

  private mapGameState(row: Record<string, unknown>): GameStateRecord {
    return {
      session_id: String(row.session_id),
      version: Number(row.version),
      current_turn: Number(row.current_turn),
      round_number: Number(row.round_number),
      combat_mode: bool(row.combat_mode),
      global_announcement: String(row.global_announcement ?? ''),
      camera_visible: bool(row.camera_visible),
      updated_at: String(row.updated_at),
    };
  }

  private mapPlayer(row: Record<string, unknown>): PlayerRecord {
    return {
      id: String(row.id),
      auth_user_id: (row.auth_user_id as string | null) ?? null,
      session_id: String(row.session_id),
      character_name: String(row.character_name),
      character_class: String(row.character_class ?? ''),
      character_level: Number(row.character_level),
      armor_class: Number(row.armor_class),
      current_hp: Number(row.current_hp),
      max_hp: Number(row.max_hp),
      temp_hp: Number(row.temp_hp),
      version: Number(row.version),
      spell_slots_level_1: Number(row.spell_slots_level_1),
      spell_slots_level_2: Number(row.spell_slots_level_2),
      spell_slots_level_3: Number(row.spell_slots_level_3),
      spell_slots_level_4: Number(row.spell_slots_level_4),
      spell_slots_level_5: Number(row.spell_slots_level_5),
      spell_slots_level_6: Number(row.spell_slots_level_6),
      spell_slots_level_7: Number(row.spell_slots_level_7),
      spell_slots_level_8: Number(row.spell_slots_level_8),
      spell_slots_level_9: Number(row.spell_slots_level_9),
      inspiration_tokens: Number(row.inspiration_tokens),
      portrait_url: String(row.portrait_url ?? ''),
      audience_tags: String(row.audience_tags ?? '[]'),
      is_active: bool(row.is_active),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  private mapPoll(row: Record<string, unknown>): PollRecord {
    return {
      id: String(row.id),
      session_id: String(row.session_id),
      question: String(row.question),
      is_active: bool(row.is_active),
      show_results: bool(row.show_results),
      countdown_enabled: bool(row.countdown_enabled),
      countdown_duration_seconds: Number(row.countdown_duration_seconds),
      results_duration_seconds: Number(row.results_duration_seconds),
      results_shown_at: (row.results_shown_at as string | null) ?? null,
      poll_type: (row.poll_type as PollType) || 'standard',
      display_visibility: (row.display_visibility as PollDisplayVisibility) || 'public',
      total_votes: Number(row.total_votes),
      created_at: String(row.created_at),
      ended_at: (row.ended_at as string | null) ?? null,
    };
  }
}

export function sqliteStore(dbPath: string): SqliteStore {
  return new SqliteStore(dbPath);
}
