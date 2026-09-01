import { ShowCueError } from '../errors.js';
import { createId, nowIso } from '../ids.js';
import type { QLabDriver } from '../qlab/types.js';
import type { ShowCues } from '../show/cues.js';
import type { EngineStore } from '../store/types.js';
import type { EngineEventBus } from '../events/bus.js';
import type { CommandResult, CommandType, EngineCommand, FireLogEntry } from './types.js';
import type { OscArg } from '../qlab/osc.js';

const IDEMPOTENCY_TTL_MS = 2000;

export class CommandBus {
  private recent = new Map<string, { at: number; result: CommandResult }>();

  constructor(
    private qlab: QLabDriver,
    private readonly cues: ShowCues,
    private readonly store: EngineStore,
    private readonly events: EngineEventBus
  ) {}

  setQLabDriver(qlab: QLabDriver): void {
    this.qlab = qlab;
  }

  async dispatch(command: EngineCommand): Promise<CommandResult> {
    const cached = this.recent.get(command.id);
    const now = Date.now();
    if (cached && now - cached.at <= IDEMPOTENCY_TTL_MS) {
      return cached.result;
    }

    const result = await this.execute(command);
    this.recent.set(command.id, { at: now, result });
    for (const [id, entry] of this.recent) {
      if (now - entry.at > IDEMPOTENCY_TTL_MS) this.recent.delete(id);
    }

    const log: FireLogEntry = {
      id: createId(),
      at: nowIso(),
      commandId: command.id,
      type: command.type,
      source: command.source,
      actorId: command.actorId ?? null,
      cueName: result.cueName ?? null,
      cueNumber: result.cueNumber ?? null,
      address: result.qlab?.address ?? null,
      status: result.status,
      confirmed: result.qlab?.confirmed ?? result.ok,
      error: result.error ?? null,
    };
    this.store.appendFireLog(log);
    this.events.emit('command.fired', { command, result, log });
    return result;
  }

  private async execute(command: EngineCommand): Promise<CommandResult> {
    try {
      switch (command.type) {
        case 'show.fire': {
          const name = String(command.payload?.name ?? '');
          const cueNumber = this.cues.resolve(name);
          const qlab = await this.qlab.startCue(cueNumber);
          return this.wrap(command.type, command.id, qlab, { cueName: name, cueNumber });
        }
        case 'qlab.start': {
          const cueNumber = String(command.payload?.cueNumber ?? '');
          const qlab = await this.qlab.startCue(cueNumber);
          return this.wrap(command.type, command.id, qlab, { cueNumber });
        }
        case 'qlab.stopCue': {
          const cueNumber = String(command.payload?.cueNumber ?? '');
          const qlab = await this.qlab.stopCue(cueNumber);
          return this.wrap(command.type, command.id, qlab, { cueNumber });
        }
        case 'qlab.go': {
          const cueNumber = command.payload?.cueNumber ? String(command.payload.cueNumber) : '';
          const qlab = cueNumber ? await this.qlab.startCue(cueNumber) : await this.qlab.workspaceGo();
          return this.wrap(command.type, command.id, qlab, cueNumber ? { cueNumber } : {});
        }
        case 'qlab.stop':
          return this.wrap(command.type, command.id, await this.qlab.workspaceStop());
        case 'qlab.panic':
          return this.wrap(command.type, command.id, await this.qlab.panic());
        case 'qlab.reset':
          return this.wrap(command.type, command.id, await this.qlab.reset());
        case 'qlab.custom': {
          const address = String(command.payload?.address ?? '/');
          const args = Array.isArray(command.payload?.args) ? (command.payload?.args as OscArg[]) : [];
          return this.wrap(command.type, command.id, await this.qlab.send(address, args));
        }
        default:
          return {
            commandId: command.id,
            type: command.type,
            ok: true,
            status: 'ok',
          };
      }
    } catch (error) {
      if (error instanceof ShowCueError) {
        return {
          commandId: command.id,
          type: command.type,
          ok: false,
          status: 'error',
          error: error.message,
        };
      }
      return {
        commandId: command.id,
        type: command.type,
        ok: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private wrap(
    type: CommandType,
    commandId: string,
    qlab: Awaited<ReturnType<QLabDriver['startCue']>>,
    extra: Partial<CommandResult> = {}
  ): CommandResult {
    return {
      commandId,
      type,
      ok: qlab.confirmed && qlab.status === 'ok',
      qlab,
      status: qlab.status,
      error: qlab.error,
      ...extra,
    };
  }
}
