export { createEngine, ActualPlayEngine, type EngineOptions } from './engine.js';
export { EngineError, QLabError, ShowCueError, LivePlayError, AuthPolicyError } from './errors.js';
export { createId, nowIso } from './ids.js';

export { QLabSession, createQLabSession } from './qlab/session.js';
export { DryRunQLab } from './qlab/dry-run.js';
export { QLabTcpConnection } from './qlab/connection.js';
export { oscEncode, decodeOscMessage } from './qlab/osc.js';
export { slipEncode, extractSlipFrames } from './qlab/slip.js';
export { cueAddress, canonicalizeCueMethod } from './qlab/addresses.js';
export { MockQLabServer } from './mock-qlab/server.js';
export type {
  QLabDriver,
  QLabHealth,
  QLabNetworkConfig,
  QLabCommandResult,
  QLabCueInfo,
  QLabWorkspaceInfo,
  QLabAckStatus,
} from './qlab/types.js';
export { flattenQLabCues } from './qlab/cues.js';

export { CommandBus } from './commands/bus.js';
export type { EngineCommand, CommandResult, CommandMeta, CommandType, FireLogEntry } from './commands/types.js';
export { ShowCues, normalizeShowCueMap } from './show/cues.js';
export type { ShowCueMap } from './show/cues.js';

export { EngineEventBus } from './events/bus.js';
export type { EngineEvent, EngineEventType } from './events/bus.js';

export {
  USER_ROLES,
  canControlShow,
  canTriggerPlayerAction,
  isCharacterLinkableRole,
  assertRole,
} from './auth/roles.js';
export type { UserRole, CommandSource } from './auth/roles.js';

export { applyHpButtonDelta } from './live/hp.js';
export {
  COMBAT_ACTIONS,
  calculateCombatTurn,
  getCombatAction,
  isCombatActionType,
  isTriggeringMidiNote,
  commandTypeForCombatAction,
} from './live/combat.js';

export {
  normalizePollDraft,
  buildBetrayPollDraft,
  getTimedPollLifecycleUpdate,
  normalizeCharacterPatch,
  parseInitiativeSubmission,
  shouldShowPollOnDisplay,
  buildQuickPollQuestion,
  normalizePollManagementAction,
  BETRAY_POLL_OPTIONS,
  BETRAY_POLL_QUESTION,
} from './audience/polls.js';

export { generateBridgeToken, hashBridgeToken, verifyBridgeToken } from './midi/token.js';
export { matchKeybind, MidiDedupe } from './midi/keybinds.js';
export { midiActionToCommandType, getActionTarget, parseActionData } from './midi/protocol.js';
export type { MidiEvent, MidiKeybind } from './midi/protocol.js';

export { memoryStore, MemoryStore } from './store/memory.js';
export { sqliteStore, SqliteStore } from './store/sqlite.js';
export type { EngineStore, EngineConfig, PlayerRecord, SessionRecord, PollRecord } from './store/types.js';
export { VttRuntime } from './vtt/runtime.js';
export { ACTION_CATALOG, isRegisteredAction } from './vtt/actions.js';
export { runMigrations, migrationStatus } from './store/migrations.js';
