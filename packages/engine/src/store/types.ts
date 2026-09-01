import type { UserRole } from '../auth/roles.js';
import type { FireLogEntry } from '../commands/types.js';
import type { MidiKeybind } from '../midi/protocol.js';
import type { QLabNetworkConfig } from '../qlab/types.js';
import type { ShowCueMap } from '../show/cues.js';
import type { PollDisplayVisibility, PollType } from '../audience/polls.js';

export interface AuthUserRecord {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string;
  email: string | null;
  role: UserRole;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRecord {
  id: string;
  campaign_id: string;
  session_name: string;
  session_number: number;
  is_active: boolean;
  started_at: string;
  ended_at: string | null;
}

export interface GameStateRecord {
  session_id: string;
  version: number;
  current_turn: number;
  round_number: number;
  combat_mode: boolean;
  global_announcement: string;
  camera_visible: boolean;
  updated_at: string;
}

export interface PlayerRecord {
  id: string;
  auth_user_id: string | null;
  session_id: string;
  character_name: string;
  character_class: string;
  character_level: number;
  armor_class: number;
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  version: number;
  spell_slots_level_1: number;
  spell_slots_level_2: number;
  spell_slots_level_3: number;
  spell_slots_level_4: number;
  spell_slots_level_5: number;
  spell_slots_level_6: number;
  spell_slots_level_7: number;
  spell_slots_level_8: number;
  spell_slots_level_9: number;
  inspiration_tokens: number;
  portrait_url: string;
  audience_tags: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InitiativeRecord {
  id: string;
  session_id: string;
  participant_id: string;
  participant_type: 'player' | 'enemy';
  participant_name: string;
  initiative_result: number;
  initiative_modifier: number;
  initiative_total: number;
  sort_order: number;
  is_ready: boolean;
  is_boss: boolean;
  boss_damage_taken: number;
}

export interface InitiativePromptRecord {
  id: string;
  session_id: string;
  is_active: boolean;
  show_results: boolean;
  created_at: string;
  ended_at: string | null;
}

export interface PlayerActionRecord {
  id: string;
  player_id: string;
  label: string;
  description: string;
  cue_name: string;
  cue_number: string;
  sort_order: number;
  is_enabled: boolean;
}

export interface VirtualButtonRecord {
  id: string;
  position: number;
  label: string;
  color: string;
  action_type: string;
  action_data: Record<string, unknown>;
  key_bind: string;
  is_active: boolean;
}

export interface PollRecord {
  id: string;
  session_id: string;
  question: string;
  is_active: boolean;
  show_results: boolean;
  countdown_enabled: boolean;
  countdown_duration_seconds: number;
  results_duration_seconds: number;
  results_shown_at: string | null;
  poll_type: PollType;
  display_visibility: PollDisplayVisibility;
  total_votes: number;
  created_at: string;
  ended_at: string | null;
}

export interface PollOptionRecord {
  id: string;
  poll_id: string;
  option_text: string;
  option_order: number;
  vote_count: number;
}

export interface EngineConfig {
  qlab: QLabNetworkConfig;
  cues: ShowCueMap;
  midiEnabled: boolean;
  bridgeTokenHash: string | null;
  bridgeTokenCreatedAt: string | null;
}

export interface EngineStore {
  getConfig(): EngineConfig;
  setQLabConfig(config: QLabNetworkConfig): void;
  setShowCues(cues: ShowCueMap): void;
  setBridgeTokenHash(hash: string, createdAt: string): void;

  appendFireLog(entry: FireLogEntry): void;
  listFireLog(limit?: number): FireLogEntry[];

  getUserByUsername(username: string): AuthUserRecord | null;
  getUserById(id: string): AuthUserRecord | null;
  listUsers(): AuthUserRecord[];
  createUser(user: AuthUserRecord): AuthUserRecord;
  updateUser(id: string, patch: Partial<AuthUserRecord>): AuthUserRecord;

  getActiveSession(): SessionRecord | null;
  createSession(input: { campaignId?: string; name?: string }): SessionRecord;
  endActiveSessions(): void;

  getGameState(sessionId: string): GameStateRecord;
  updateGameState(sessionId: string, patch: Partial<GameStateRecord>): GameStateRecord;

  listPlayers(sessionId: string): PlayerRecord[];
  getPlayer(id: string): PlayerRecord | null;
  getPlayerByAuthUserId(authUserId: string, sessionId: string): PlayerRecord | null;
  createPlayer(player: PlayerRecord): PlayerRecord;
  updatePlayer(id: string, patch: Partial<PlayerRecord>, expectedVersion?: number): PlayerRecord;

  listInitiative(sessionId: string): InitiativeRecord[];
  replaceInitiative(sessionId: string, rows: InitiativeRecord[]): void;
  getActiveInitiativePrompt(sessionId: string): InitiativePromptRecord | null;
  setInitiativePrompt(prompt: InitiativePromptRecord): void;
  closeInitiativePrompts(sessionId: string): void;

  listPlayerActions(playerId: string): PlayerActionRecord[];
  getPlayerAction(id: string): PlayerActionRecord | null;
  upsertPlayerAction(action: PlayerActionRecord): PlayerActionRecord;

  listVirtualButtons(): VirtualButtonRecord[];
  upsertVirtualButton(button: VirtualButtonRecord): VirtualButtonRecord;
  deleteVirtualButton(id: string): void;

  listMidiKeybinds(): MidiKeybind[];
  replaceMidiKeybinds(binds: MidiKeybind[]): void;

  listPolls(sessionId: string): PollRecord[];
  getPoll(id: string): PollRecord | null;
  createPoll(poll: PollRecord, options: PollOptionRecord[]): PollRecord;
  updatePoll(id: string, patch: Partial<PollRecord>): PollRecord;
  listPollOptions(pollId: string): PollOptionRecord[];
  addVote(pollId: string, optionId: string, fingerprint: string): PollOptionRecord;

  close(): void;
}
