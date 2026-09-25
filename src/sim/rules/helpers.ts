import { approach } from '../math';
import type {
  DeepReadonly,
  Effect,
  Evidence,
  Mapxel,
  MutableField,
} from '../types';
import type { MapxelQuantity } from '../units';

export function isLand(cell: DeepReadonly<Mapxel>): boolean {
  return cell.biome !== 'water';
}

export function delta<Field extends MutableField>(
  cell: DeepReadonly<Mapxel>,
  field: Field,
  amount: MapxelQuantity<Field>,
  evidence?: Evidence,
): Effect {
  return {
    kind: 'delta',
    cell: cell.id,
    field,
    amount,
    evidence,
  };
}

export function changeToward<Field extends MutableField>(
  cell: DeepReadonly<Mapxel>,
  field: Field,
  target: MapxelQuantity<Field>,
  rate: number,
  evidence?: Evidence,
): Effect {
  const amount = approach(cell[field], target, rate) as MapxelQuantity<Field>;
  return delta(cell, field, amount, evidence);
}

export function read(
  cell: DeepReadonly<Mapxel>,
  field: MutableField,
  label: string,
): { cell: number; field: MutableField; label: string } {
  return { cell: cell.id, field, label };
}
