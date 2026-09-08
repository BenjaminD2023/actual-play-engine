import { PackError } from './errors.js';
import { COMPARE_OPS, type Condition, type ProductionVariable } from './types.js';
import { isRecord } from './canonical.js';
import { requireEnum, requireRecord, requireString } from './validate-helpers.js';

export function parseCondition(value: unknown): Condition | null {
  if (value === undefined || value === null) return null;
  const rec = requireRecord(value, 'condition');
  if (rec.kind === 'group' || rec.mode === 'all' || rec.mode === 'any' || rec.clauses) {
    const mode = requireEnum(rec.mode ?? 'all', ['all', 'any'] as const, 'condition.mode');
    const clauses = Array.isArray(rec.clauses) ? rec.clauses.map(parseCondition).filter((c): c is Condition => Boolean(c)) : [];
    return { kind: 'group', mode, clauses };
  }
  return {
    kind: 'atom',
    variableId: requireString(rec.variableId, 'condition.variableId'),
    op: requireEnum(rec.op, COMPARE_OPS, 'condition.op'),
    value: rec.value as boolean | number | string | undefined,
  };
}

export function evaluateCondition(
  condition: Condition | null,
  variables: Record<string, boolean | number | string>
): boolean {
  if (!condition) return true;
  if (condition.kind === 'group') {
    if (condition.clauses.length === 0) return true;
    return condition.mode === 'all'
      ? condition.clauses.every((clause) => evaluateCondition(clause, variables))
      : condition.clauses.some((clause) => evaluateCondition(clause, variables));
  }
  const current = variables[condition.variableId];
  switch (condition.op) {
    case 'eq':
      return current === condition.value;
    case 'neq':
      return current !== condition.value;
    case 'gt':
      return typeof current === 'number' && typeof condition.value === 'number' && current > condition.value;
    case 'lt':
      return typeof current === 'number' && typeof condition.value === 'number' && current < condition.value;
    case 'contains':
      return typeof current === 'string' && typeof condition.value === 'string' && current.includes(condition.value);
    case 'is_true':
      return current === true;
    case 'is_false':
      return current === false;
    default:
      throw new PackError('invalid_request', `Unsupported condition op.`);
  }
}

export function defaultVariableMap(vars: ProductionVariable[]): Record<string, boolean | number | string> {
  const out: Record<string, boolean | number | string> = {};
  for (const variable of vars) out[variable.id] = variable.defaultValue;
  return out;
}

export function assertNoJs(value: unknown): void {
  const text = JSON.stringify(value);
  if (/\b(eval|Function|constructor)\b/.test(text)) {
    throw new PackError('invalid_pack', 'Arbitrary script expressions are not allowed in conditions.');
  }
  if (isRecord(value) && typeof value.expr === 'string') {
    throw new PackError('invalid_pack', 'Arbitrary expressions are not allowed.');
  }
}
