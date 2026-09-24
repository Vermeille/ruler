import { MUTABLE_FIELDS, validMapxelFieldValue } from '../map-fields';
import {
  ARCHETYPE_COUNT,
  ARCHETYPE_MODEL_VERSION,
} from '../population/archetypes';
import {
  POPULATION_STATE_FIELD_NAMES,
  POPULATION_TRANSITION_FIELDS,
  readPopulationStateField,
  validPopulationStateValue,
} from '../population/fields';
import { SECTORS, type DeepReadonly, type Model, type PopulationTransitionField } from '../types';

/** Validate model invariants at engine and persistence boundaries. */
export function assertModel(model: DeepReadonly<Model>): void {
  if (model.archetypeModelVersion !== ARCHETYPE_MODEL_VERSION
    || !Number.isSafeInteger(model.nextPopulationGroupId)
    || model.nextPopulationGroupId < 1
    || model.populationGroups.length !== model.cells.length) {
    throw new Error('Invalid population model.');
  }

  const groupIds = new Set<number>();
  for (const cell of model.cells) {
    const groups = model.populationGroups[cell.id];
    if (!Array.isArray(groups) || (cell.biome === 'water' && groups.length > 0)) {
      throw new Error(`Invalid population groups in mapxel ${cell.id}.`);
    }

    let total = 0;
    for (const group of groups) {
      if (!group.attitudes
        || !Number.isSafeInteger(group.id)
        || group.id < 1
        || group.id >= model.nextPopulationGroupId
        || groupIds.has(group.id)
        || !Number.isInteger(group.archetype)
        || group.archetype < 0
        || group.archetype >= ARCHETYPE_COUNT
        || !Number.isFinite(group.count)
        || group.count < -1e-9) {
        throw new Error(`Invalid population group ${group.id}.`);
      }

      for (const field of POPULATION_STATE_FIELD_NAMES) {
        if (!validPopulationStateValue(field, readPopulationStateField(group, field), 1e-9)) {
          throw new Error(`Invalid population group ${group.id}.`);
        }
      }

      for (const [field, spec] of Object.entries(POPULATION_TRANSITION_FIELDS)) {
        const transitionField = field as PopulationTransitionField;
        if (!spec.valid(group[transitionField])) {
          throw new Error(`Invalid population group ${group.id}.`);
        }
      }

      groupIds.add(group.id);
      total += group.count;
    }

    if (Math.abs(total - cell.population) > Math.max(1e-6, cell.population * 1e-9)) {
      throw new Error(`Population group count differs from mapxel ${cell.id}.`);
    }
  }

  const publicAccounts = [model.treasury, model.debt, model.externalCash];
  if (!publicAccounts.every(value => Number.isFinite(value) && value >= -1e-5)) {
    throw new Error('Invalid public accounts.');
  }

  for (const cell of model.cells) {
    for (const field of MUTABLE_FIELDS) {
      const value = cell[field];
      if (!validMapxelFieldValue(field, value, 1e-6)) {
        throw new Error(`Invalid ${field} in mapxel ${cell.id}: ${value}`);
      }
    }

    if (cell.biome !== 'water') {
      const sectorTotal = SECTORS.reduce((sum, sector) => sum + cell[sector], 0);
      if (Math.abs(sectorTotal - 1) > 1e-6) {
        throw new Error(`Sector shares must sum to one: ${cell.id}`);
      }
    }

    if (cell.children + cell.seniors > 1) {
      throw new Error('Invalid demographics.');
    }

    if (model.policy.laws.foodPriceControls && cell.price > 1 + 1e-6) {
      throw new Error('Posted food price exceeds the administered ceiling.');
    }
  }
}
