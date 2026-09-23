import { approach } from '../math';
import type {
  DeepReadonly,
  Effect,
  Evidence,
  Mapxel,
  MutableField,
} from '../types';

export function isLand(cell: DeepReadonly<Mapxel>): boolean {
  return cell.biome !== 'water';
}

export function delta(
  cell: DeepReadonly<Mapxel>,
  field: MutableField,
  amount: number,
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

export function changeToward(
  cell: DeepReadonly<Mapxel>,
  field: MutableField,
  target: number,
  rate: number,
  evidence?: Evidence,
): Effect {
  return delta(cell, field, approach(cell[field], target, rate), evidence);
}

export function read(
  cell: DeepReadonly<Mapxel>,
  field: MutableField,
  label: string,
): { cell: number; field: MutableField; label: string } {
  return { cell: cell.id, field, label };
}
