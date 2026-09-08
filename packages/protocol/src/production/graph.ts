import { PackError } from './errors.js';
import type { ActionStep, ProductionAction, ProductionTrigger } from './types.js';

function walkSteps(steps: ActionStep[] | undefined, visit: (step: ActionStep) => void): void {
  for (const step of steps ?? []) {
    visit(step);
    walkSteps(step.children, visit);
    walkSteps(step.then, visit);
    walkSteps(step.else, visit);
  }
}

export function collectActionCalls(action: ProductionAction): string[] {
  const ids: string[] = [];
  walkSteps(action.steps, (step) => {
    if (typeof step.params.actionId === 'string') ids.push(step.params.actionId);
  });
  return ids;
}

export function assertNoCircularActions(actions: ProductionAction[]): void {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const visiting = new Set<string>();
  const seen = new Set<string>();

  const visit = (id: string, stack: string[]) => {
    if (seen.has(id)) return;
    if (visiting.has(id)) {
      throw new PackError('circular_reference', `Circular action reference: ${[...stack, id].join(' -> ')}`);
    }
    visiting.add(id);
    const action = byId.get(id);
    if (action) {
      for (const next of collectActionCalls(action)) visit(next, [...stack, id]);
    }
    visiting.delete(id);
    seen.add(id);
  };

  for (const action of actions) visit(action.id, []);
}

export function assertTriggerTargets(triggers: ProductionTrigger[], actions: ProductionAction[]): void {
  const ids = new Set(actions.map((action) => action.id));
  for (const trigger of triggers) {
    if (!ids.has(trigger.actionId)) {
      throw new PackError('invalid_pack', `Trigger ${trigger.id} points at missing action ${trigger.actionId}.`);
    }
  }
}

export function reachableActionIds(actions: ProductionAction[], triggers: ProductionTrigger[], controlActionIds: string[]): Set<string> {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const queue = [...controlActionIds, ...triggers.map((trigger) => trigger.actionId)];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const action = byId.get(id);
    if (!action) continue;
    queue.push(...collectActionCalls(action));
  }
  return seen;
}
