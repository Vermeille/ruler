<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '../sim/types';
import type { PhaseTrace } from '../sim/trace';
import {
  appealDrivers,
  migrationDownstreamImpact,
  migrationEdges,
  migrationSensitivities,
  type MigrationEdge,
} from './migration-analysis';
import { migrationAppeal } from '../sim/rules/society';
import './migration-lens.css';

const props = defineProps<{
  game: Game;
  phase: PhaseTrace;
}>();

const CELL_SIZE = 28;
const selectedEdgeKey = ref('');

const model = computed(() => props.phase.before);
const edges = computed(() => migrationEdges(model.value));
const selectedEdge = computed(() => (
  edges.value.find(edge => edge.key === selectedEdgeKey.value) ?? edges.value[0]
));
const drivers = computed(() => (
  selectedEdge.value ? appealDrivers(model.value, selectedEdge.value) : []
));
const sensitivities = computed(() => (
  selectedEdge.value ? migrationSensitivities(model.value, selectedEdge.value) : []
));
const downstream = computed(() => migrationDownstreamImpact(props.game));
const maxFlow = computed(() => Math.max(...edges.value.map(edge => edge.population), 1e-9));
const maxDriver = computed(() => Math.max(...drivers.value.map(driver => Math.abs(driver.difference)), 1e-9));
const maxSensitivity = computed(() => Math.max(
  ...sensitivities.value.map(item => Math.abs(item.flowImpact)),
  1e-9,
));

const appealRange = computed(() => {
  const values = model.value.cells
    .filter(cell => cell.biome !== 'water')
    .map(cell => migrationAppeal(cell));
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
});

watch(edges, next => {
  if (!next.length) {
    selectedEdgeKey.value = '';
    return;
  }
  if (!next.some(edge => edge.key === selectedEdgeKey.value)) {
    selectedEdgeKey.value = next[0].key;
  }
}, { immediate: true });

function cellCenter(id: number): { x: number; y: number } {
  const cell = model.value.cells[id];
  return {
    x: (cell.x + 0.5) * CELL_SIZE,
    y: (cell.y + 0.5) * CELL_SIZE,
  };
}

function appealColor(id: number): string {
  const cell = model.value.cells[id];
  if (cell.biome === 'water') return 'hsl(218 24% 11%)';
  const appeal = migrationAppeal(cell);
  const range = Math.max(1e-9, appealRange.value.max - appealRange.value.min);
  const t = (appeal - appealRange.value.min) / range;
  const hue = 12 + t * 166;
  const lightness = 23 + t * 30;
  return `hsl(${hue} 63% ${lightness}%)`;
}

function flowWidth(edge: MigrationEdge): number {
  return 0.7 + Math.sqrt(edge.population / maxFlow.value) * 5.5;
}

function flowOpacity(edge: MigrationEdge): number {
  return 0.22 + Math.sqrt(edge.population / maxFlow.value) * 0.68;
}

function driverWidth(value: number): string {
  return `${Math.max(2, Math.abs(value) / maxDriver.value * 48)}%`;
}

function sensitivityWidth(value: number): string {
  return `${Math.max(2, Math.abs(value) / maxSensitivity.value * 100)}%`;
}

function formatPeople(value: number): string {
  if (Math.abs(value) < 0.01) return value.toFixed(3);
  if (Math.abs(value) < 10) return value.toFixed(2);
  return value.toFixed(1);
}

function formatAppeal(value: number): string {
  return value.toFixed(3);
}

function formatRelative(value: number): string {
  if (value < 0.0001) return '<0.01%';
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function cellName(id: number): string {
  return model.value.cells[id]?.name ?? `#${id}`;
}

function selectEdge(edge: MigrationEdge): void {
  selectedEdgeKey.value = edge.key;
}
</script>

<template>
  <section class="migration-lens" aria-label="Migration causal lens">
    <div class="causal-lens-heading">
      <div>
        <span class="dev-kicker">CAUSAL LENS / SOCIETY.MIGRATION</span>
        <h3>Why do people move, and what changes because they did?</h3>
        <p>
          Each neighboring pair compares local appeal. The map shows the actual flows proposed this month;
          the explanation on the right decomposes one selected flow into its drivers and local sensitivities.
        </p>
      </div>
      <div class="migration-law" :class="{ restricted: !model.policy.laws.freeMovement }">
        <span>Movement law</span>
        <strong>{{ model.policy.laws.freeMovement ? 'Free movement' : 'Restricted' }}</strong>
        <small>{{ model.policy.laws.freeMovement ? '100% of calculated flow' : '8% of calculated flow' }}</small>
      </div>
    </div>

    <div class="migration-visual-grid">
      <div class="migration-map-card">
        <div class="migration-map-header">
          <div>
            <span class="dev-kicker">SPATIAL FLOW</span>
            <h4>Appeal and migration</h4>
          </div>
          <div class="appeal-legend">
            <span>lower appeal</span>
            <i />
            <span>higher appeal</span>
          </div>
        </div>

        <svg
          class="migration-flow-map"
          :viewBox="`0 0 ${model.width * CELL_SIZE} ${model.height * CELL_SIZE}`"
          role="img"
          aria-label="Migration flow map"
        >
          <defs>
            <marker id="migration-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>

          <rect
            v-for="cell in model.cells"
            :key="`cell-${cell.id}`"
            :x="cell.x * CELL_SIZE + 1"
            :y="cell.y * CELL_SIZE + 1"
            :width="CELL_SIZE - 2"
            :height="CELL_SIZE - 2"
            :fill="appealColor(cell.id)"
            class="migration-cell"
            :class="{ water: cell.biome === 'water' }"
          >
            <title v-if="cell.biome !== 'water'">{{ cell.name }} · appeal {{ formatAppeal(migrationAppeal(cell)) }}</title>
          </rect>

          <g class="migration-arrows">
            <line
              v-for="edge in edges"
              :key="edge.key"
              :x1="cellCenter(edge.from).x"
              :y1="cellCenter(edge.from).y"
              :x2="cellCenter(edge.to).x"
              :y2="cellCenter(edge.to).y"
              :stroke-width="flowWidth(edge)"
              :opacity="flowOpacity(edge)"
              marker-end="url(#migration-arrow)"
              class="migration-arrow"
              :class="{ selected: selectedEdge?.key === edge.key }"
              tabindex="0"
              @click="selectEdge(edge)"
              @keydown.enter="selectEdge(edge)"
            >
              <title>{{ cellName(edge.from) }} → {{ cellName(edge.to) }} · {{ formatPeople(edge.population) }} people/month</title>
            </line>
          </g>
        </svg>

        <div class="flow-map-caption">
          <span><strong>Cell color</strong> = migration appeal</span>
          <span><strong>Arrow</strong> = direction</span>
          <span><strong>Thickness</strong> = people / month</span>
        </div>

        <div class="largest-flows">
          <button
            v-for="edge in edges.slice(0, 6)"
            :key="`rank-${edge.key}`"
            :class="{ active: selectedEdge?.key === edge.key }"
            @click="selectEdge(edge)"
          >
            <span>{{ cellName(edge.from) }} → {{ cellName(edge.to) }}</span>
            <strong>{{ formatPeople(edge.population) }}</strong>
          </button>
        </div>
      </div>

      <aside v-if="selectedEdge" class="migration-explanation">
        <div class="selected-flow-summary">
          <span class="dev-kicker">SELECTED FLOW</span>
          <h4>{{ cellName(selectedEdge.from) }} <span>→</span> {{ cellName(selectedEdge.to) }}</h4>
          <div class="flow-number">
            <strong>{{ formatPeople(selectedEdge.population) }}</strong>
            <span>people / month</span>
          </div>
          <p>
            Appeal {{ formatAppeal(selectedEdge.appealFrom) }} → {{ formatAppeal(selectedEdge.appealTo) }}.
            The gap is {{ formatAppeal(selectedEdge.appealDifference) }}.
          </p>
          <div class="flow-formula">
            <code>|appeal gap| × 0.007</code>
            <span>→</span>
            <strong>{{ (selectedEdge.movementRate * 100).toFixed(3) }}% / month</strong>
            <em v-if="selectedEdge.movementRate >= 0.002999">rate cap reached</em>
          </div>
        </div>

        <section class="driver-section">
          <div class="micro-heading">
            <span class="dev-kicker">INPUTS</span>
            <h5>What makes the destination more attractive?</h5>
          </div>
          <p class="explain-note">Bars show each term's contribution to the <em>appeal difference</em>. Right favors the destination; left favors the origin.</p>
          <div class="driver-list">
            <div v-for="driver in drivers" :key="driver.key" class="driver-row">
              <span>{{ driver.label }}</span>
              <div class="signed-bar">
                <i class="bar-zero" />
                <i
                  class="bar-fill"
                  :class="driver.difference >= 0 ? 'positive' : 'negative'"
                  :style="{ width: driverWidth(driver.difference) }"
                />
              </div>
              <strong :class="driver.difference >= 0 ? 'positive' : 'negative'">
                {{ driver.difference >= 0 ? '+' : '' }}{{ driver.difference.toFixed(3) }}
              </strong>
            </div>
          </div>
        </section>

        <section class="sensitivity-section">
          <div class="micro-heading">
            <span class="dev-kicker">LOCAL SENSITIVITY</span>
            <h5>Which inputs matter here?</h5>
          </div>
          <p class="explain-note">Each bar reruns this pair after a small nudge. It is a local finite-difference estimate, so caps and direction changes are visible rather than hidden.</p>
          <div class="sensitivity-list">
            <div v-for="item in sensitivities" :key="item.key" class="sensitivity-row">
              <div>
                <span>{{ item.label }}</span>
                <small>{{ item.nudgeLabel }}</small>
              </div>
              <div class="sensitivity-track">
                <i
                  :class="item.flowImpact >= 0 ? 'positive' : 'negative'"
                  :style="{ width: sensitivityWidth(item.flowImpact) }"
                />
              </div>
              <strong :class="item.flowImpact >= 0 ? 'positive' : 'negative'">
                {{ item.flowImpact >= 0 ? '+' : '' }}{{ formatPeople(item.flowImpact) }}
              </strong>
            </div>
          </div>
        </section>
      </aside>
    </div>

    <section class="migration-downstream">
      <div class="downstream-heading">
        <div>
          <span class="dev-kicker">COUNTERFACTUAL PROPAGATION</span>
          <h4>What does migration change next?</h4>
          <p>
            The engine is run twice: normally, and with only <code>society.migration</code> disabled.
            Each node shows where those worlds diverge. No divergence means migration did not matter there in this state.
          </p>
        </div>
        <div class="counterfactual-key">
          <span>real world</span><i>−</i><span>same world, no migration</span>
        </div>
      </div>

      <div class="impact-timeline">
        <article
          v-for="stage in downstream"
          :key="stage.key"
          class="impact-stage"
          :class="{ quiet: stage.magnitude < 1e-7 }"
        >
          <div class="impact-stage-top">
            <span>{{ stage.month }}</span>
            <strong>{{ stage.phase }}</strong>
          </div>
          <div class="impact-pulse" :style="{ '--impact': Math.min(1, stage.magnitude * 40) }" />
          <p><strong>{{ stage.changedCells }}</strong> mapxels differ</p>
          <div class="impact-fields">
            <span v-for="field in stage.fields.slice(0, 3)" :key="field.field">
              {{ field.field }} <strong>{{ formatRelative(field.relative) }}</strong>
            </span>
            <span v-if="!stage.fields.length" class="no-impact">no propagated state difference</span>
          </div>
          <small>{{ stage.rules.join(', ') }}</small>
        </article>
      </div>
    </section>
  </section>
</template>