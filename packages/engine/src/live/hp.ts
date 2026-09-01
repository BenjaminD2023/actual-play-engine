export interface HpTotals {
  current_hp: number;
  max_hp: number;
  temp_hp: number;
}

export function applyHpButtonDelta({
  current_hp,
  max_hp,
  temp_hp,
  delta,
}: HpTotals & { delta: number }): Pick<HpTotals, 'current_hp' | 'temp_hp'> {
  const safeMaxHP = Math.max(1, max_hp);
  const safeCurrentHP = Math.max(0, Math.min(safeMaxHP, current_hp));
  const safeTempHP = Math.max(0, temp_hp);

  if (delta >= 0) {
    return {
      current_hp: Math.min(safeMaxHP, safeCurrentHP + delta),
      temp_hp: safeTempHP,
    };
  }

  const incomingDamage = Math.abs(delta);
  const absorbedByTemp = Math.min(safeTempHP, incomingDamage);
  const remainingDamage = incomingDamage - absorbedByTemp;

  return {
    current_hp: Math.max(0, safeCurrentHP - remainingDamage),
    temp_hp: safeTempHP - absorbedByTemp,
  };
}
