import type { GridMode, Point, RulesAdapterInfo } from '@actualplay/protocol';
import { distance } from './geometry.js';

export interface RulesAdapter {
  info: RulesAdapterInfo;
  measure(a: Point, b: Point, mode: GridMode, gridSize: number): number;
  terrainMultiplier(kind: string): number;
  tokenSizeName(cells: number): string;
}

export const genericAdapter: RulesAdapter = {
  info: { id: 'generic', name: 'Generic', units: 'ft', diagonal: 'euclidean' },
  measure(a, b, mode, gridSize) {
    return distance(a, b, mode, gridSize, 'euclidean');
  },
  terrainMultiplier() {
    return 1;
  },
  tokenSizeName(cells) {
    if (cells <= 1) return 'medium';
    if (cells === 2) return 'large';
    return 'huge';
  },
};

export const d20Adapter: RulesAdapter = {
  info: { id: 'd20-example', name: 'D20-style example', units: 'ft', diagonal: '5105' },
  measure(a, b, mode, gridSize) {
    return distance(a, b, mode, gridSize, '5105');
  },
  terrainMultiplier(kind) {
    return kind === 'difficult' ? 2 : 1;
  },
  tokenSizeName(cells) {
    if (cells <= 1) return 'Medium';
    if (cells === 2) return 'Large';
    if (cells === 3) return 'Huge';
    return 'Gargantuan';
  },
};

export class RulesRegistry {
  private adapters = new Map<string, RulesAdapter>([
    [genericAdapter.info.id, genericAdapter],
    [d20Adapter.info.id, d20Adapter],
  ]);
  current: RulesAdapter = genericAdapter;

  register(adapter: RulesAdapter): void {
    this.adapters.set(adapter.info.id, adapter);
  }

  use(id: string): RulesAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) return this.current;
    this.current = adapter;
    return adapter;
  }

  list(): RulesAdapterInfo[] {
    return [...this.adapters.values()].map((adapter) => adapter.info);
  }
}
