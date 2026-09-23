<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '../sim/types';
import type { PhaseTrace } from '../sim/trace';
import { analyzeRule, type JacobianCell } from './rule-analysis';
import { analyzeRuleInfluence } from './rule-influence';
import './rule-lens.css';

const props = defineProps<{
  game: Game;
  phase: PhaseTrace;
  ruleId: string;
}>();

const CELL_SIZE = 28;
const analysis = computed(() => analyzeRule(props.game, props.phase, props.ruleId));
const selectedOutputKey = ref('');
const selectedSensitivityKey = ref('');

const selectedOutput = computed(() => (
  analysis.value?.outputs.find(output => output.key === selectedOutputKey.value)
));

const influence = computed(() => analyzeRuleInfluence(
  props.game,
  props.phase,
  props.ruleId,
  selectedOutputKey.value,
));

const inputRows = computed(() => {
  const current = analysis.value;
  if (!current) return [];

  return current.inputs.map(input => ({
    input,
    sensitivity: current.jacobian.find(cell => (
      cell.inputKey === input.key && cell.outputKey === selectedOutputKey.value
    )),
  })).sort((left, right) => (
    (right.sensitivity?.strength ?? 0) - (left.sensitivity?.strength ?? 0)
      || right.input.reads - left.input.reads
  ));
});

const selectedSensitivity = computed(() => (
  analysis.value?.jacobian.find(cell => cell.key === selectedSensitivityKey.value)
));

const footprintByCell = computed(() => new Map(
  analysis.value?.footprintCells.map(cell => [cell.id, cell]) ?? [],
));

const visibleFlows = computed(() => {
  const flows = analysis.value?.footprintFlows ?? [];
  return selectedOutputKey.value
    ? flows.filter(flow => flow.outputKey === selectedOutputKey.value)
    : flows;
});

const activeFootprintCount = computed(() => (
  analysis.value?.footprintCells.filter(cell => (
    !selectedOutputKey.value || cell.outputKeys.includes(selectedOutputKey.value)
  )).length ?? 0
));

watch(analysis, next => {
  selectedOutputKey.value = next?.outputs[0]?.key ?? '';
}, { immediate: true });

watch([analysis, selectedOutputKey], () => {
  selectedSensitivityKey.value = inputRows.value
    .find(row => row.sensitivity)?.sensitivity?.key ?? '';
}, { immediate: true });

function sensitivityWidth(cell: JacobianCell | undefined): string {
  if (!cell) return '0%';
  return `${Math.max(2, cell.strength * 100)}%`;
}

function heatColor(id: number): string {
  const cell = props.phase.before.cells[id];
  if (cell.biome === 'water') return 'hsl(218 24% 11%)';

  const footprint = footprintByCell.value.get(id);
  if (!footprint) return 'hsl(219 19% 17%)';

  const selected = !selectedOutputKey.value
    || footprint.outputKeys.includes(selectedOutputKey.value);
  const strength = selected ? footprint.score : footprint.score * 0.08;
  const lightness = 21 + strength * 43;
  const saturation = 25 + strength * 52;
  return `hsl(187 ${saturation}% ${lightness}%)`;
}

function center(id: number): { x: number; y: number } {
  const cell = props.phase.before.cells[id];
  return {
    x: (cell.x + 0.5) * CELL_SIZE,
    y: (cell.y + 0.5) * CELL_SIZE,
  };
}

function flowWidth(score: number): number {
  return 0.9 + Math.sqrt(score) * 5.6;
}

function flowOpacity(score: number): number {
  return 0.35 + Math.sqrt(score) * 0.65;
}

function cellName(id: number): string {
  return props.phase.before.cells[id]?.name ?? `cell ${id}`;
}

function formatMagnitude(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (Math.abs(value) >= 1) return value.toFixed(2);
  if (Math.abs(value) >= 0.01) return value.toFixed(4);
  return value.toExponential(2);
}

function formatRelative(value: number): string {
  if (value <= 0) return '0%';
  if (value < 0.0001) return '<0.01%';
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function selectSensitivity(cell: JacobianCell | undefined): void {
  if (!cell) return;
  selectedSensitivityKey.value = cell.key;
}
</script>

<template>
  <section v-if="analysis" class="rule-lens" aria-label="Rule causal explanation">
    <header class="rule-lens-header">
      <div>
        <span class="dev-kicker">CAUSAL LENS / {{ analysis.ruleId }}</span>
        <h3>Inputs → rule → outputs → consumers</h3>
        <p>{{ analysis.description }}</p>
      </div>
      <div class="analysis-sampling">
        <strong>{{ analysis.analyzedReads }}</strong>
        <span>local perturbations</span>
        <small>from {{ analysis.totalReads }} meaningful reads</small>
      </div>
    </header>

    <nav v-if="analysis.outputs.length" class="rule-output-strip" aria-label="Rule outputs">
      <span class="output-strip-label">OUTPUT</span>
      <button
        v-for="output in analysis.outputs"
        :key="output.key"
        :class="{ active: selectedOutputKey === output.key }"
        @click="selectedOutputKey = output.key"
      >
        <span>{{ output.label }}</span>
        <strong>{{ formatMagnitude(output.magnitude) }}</strong>
        <small>{{ output.effects }} channels</small>
      </button>
    </nav>

    <section class="sensitivity-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">INPUTS</span>
          <h4 v-if="selectedOutput">What drives {{ selectedOutput.label }} here?</h4>
          <h4 v-else>What did this rule read before emitting nothing?</h4>
        </div>
        <p v-if="selectedOutput">
          A small local nudge is applied to sampled reads, then the same rule runs again.
          Bars are relative to the strongest input for this output.
        </p>
        <p v-else>
          The rule emitted no effects in this state. Its actual reads are still shown so thresholds and inactive branches remain visible.
        </p>
      </div>

      <div class="sensitivity-list" :class="{ inactive: !selectedOutput }">
        <button
          v-for="row in inputRows"
          :key="row.input.key"
          class="sensitivity-row"
          :class="{
            active: selectedSensitivityKey === row.sensitivity?.key,
            inert: !row.sensitivity,
          }"
          @click="selectSensitivity(row.sensitivity)"
        >
          <div class="sensitivity-label">
            <strong>{{ row.input.label }}</strong>
            <small>{{ row.input.reads }} reads · {{ row.input.analyzed }} sampled</small>
          </div>
          <div class="sensitivity-score">
            <strong v-if="row.sensitivity">{{ Math.round(row.sensitivity.strength * 100) }}</strong>
            <span v-else>0</span>
          </div>
          <div class="sensitivity-bar" aria-hidden="true">
            <i
              v-if="row.sensitivity"
              :class="row.sensitivity.sign"
              :style="{ width: sensitivityWidth(row.sensitivity) }"
            />
          </div>
        </button>
      </div>

      <div v-if="selectedSensitivity" class="sensitivity-detail">
        <div>
          <span class="dev-kicker">CONCRETE READ</span>
          <strong>{{ selectedSensitivity.example }}</strong>
          <small>{{ selectedSensitivity.nudge }}</small>
        </div>
        <div class="causal-arrow">→</div>
        <div>
          <span class="dev-kicker">OUTPUT RESPONSE</span>
          <strong>{{ selectedOutput?.label }}</strong>
          <small>
            Δ {{ formatMagnitude(selectedSensitivity.response) }} · raw local derivative
            {{ formatMagnitude(selectedSensitivity.derivative) }}
          </small>
        </div>
      </div>

      <div class="sensitivity-legend">
        <span><i class="positive" /> increases output</span>
        <span><i class="negative" /> decreases output</span>
        <span><i class="mixed" /> mixed direction across concrete channels</span>
        <span><strong>100</strong> = strongest sampled local input for this output</span>
      </div>
    </section>

    <section class="influence-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">DIRECT CONSUMERS</span>
          <h4>Which rules read what {{ analysis.ruleId }} writes?</h4>
        </div>
        <p>
          These are direct state dependencies, not inferred correlations. An edge appears only when a later rule actually reads an exact state path written by the selected output. Next-month self edges expose feedback loops.
        </p>
      </div>

      <div class="influence-graph">
        <article class="influence-source">
          <span>THIS RULE</span>
          <strong>{{ analysis.ruleId }}</strong>
          <small>{{ selectedOutput?.label ?? 'no emitted output selected' }}</small>
        </article>

        <div class="influence-connector" aria-hidden="true">→</div>

        <div v-if="influence.consumers.length" class="influence-consumers">
          <article
            v-for="consumer in influence.consumers"
            :key="consumer.key"
            class="influence-consumer"
            :class="{ feedback: consumer.self }"
          >
            <div class="influence-consumer-head">
              <span>{{ consumer.month }} · {{ consumer.phase }}</span>
              <em v-if="consumer.self">feedback</em>
            </div>
            <strong>{{ consumer.ruleId }}</strong>
            <div class="influence-paths">
              <span v-for="path in consumer.paths.slice(0, 3)" :key="`${consumer.key}:${path.source}:${path.path}`">
                {{ path.label }}
              </span>
              <small v-if="consumer.paths.length > 3">+{{ consumer.paths.length - 3 }} more exact reads</small>
            </div>
          </article>
        </div>

        <div v-else class="influence-empty">
          No later rule reads an exact state path written by this selected output within this month or the next one.
        </div>
      </div>
    </section>

    <section class="footprint-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">MAP EFFECTS</span>
          <h4>Where does this rule write on the map?</h4>
        </div>
        <p>
          This is not a population, wealth, or forecast map. Bright cells are mapxels where this rule is more active and that participate in the selected output. Arrows are actual transfers or trades from source to destination.
        </p>
      </div>

      <div class="footprint-key">
        <span><i class="footprint-low" /> little or no rule activity</span>
        <span><i class="footprint-high" /> stronger rule activity</span>
        <span><b>→</b> transfer / trade direction</span>
        <strong>{{ activeFootprintCount }} mapxels touched</strong>
      </div>

      <div class="footprint-map-shell" :style="{ aspectRatio: `${phase.before.width} / ${phase.before.height}` }">
        <div
          class="footprint-cell-grid"
          :style="{
            gridTemplateColumns: `repeat(${phase.before.width}, 1fr)`,
            gridTemplateRows: `repeat(${phase.before.height}, 1fr)`,
          }"
        >
          <div
            v-for="cell in phase.before.cells"
            :key="cell.id"
            class="footprint-cell-block"
            :class="{ water: cell.biome === 'water' }"
            :style="{
              gridColumn: cell.x + 1,
              gridRow: cell.y + 1,
              backgroundColor: heatColor(cell.id),
            }"
            :title="cell.name"
          />
        </div>

        <svg
          class="footprint-flow-overlay"
          :viewBox="`0 0 ${phase.before.width * CELL_SIZE} ${phase.before.height * CELL_SIZE}`"
          aria-hidden="true"
        >
          <defs>
            <marker id="rule-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <line
            v-for="flow in visibleFlows"
            :key="flow.key"
            :x1="center(flow.from).x"
            :y1="center(flow.from).y"
            :x2="center(flow.to).x"
            :y2="center(flow.to).y"
            :stroke-width="flowWidth(flow.score)"
            :opacity="flowOpacity(flow.score)"
            class="footprint-flow"
            marker-end="url(#rule-flow-arrow)"
          />
        </svg>
      </div>

      <div v-if="visibleFlows.length" class="flow-ranking">
        <div
          v-for="flow in visibleFlows.slice(0, 8)"
          :key="`rank-${flow.key}`"
          class="flow-rank-row"
        >
          <span>{{ cellName(flow.from) }}</span>
          <i>→</i>
          <span>{{ cellName(flow.to) }}</span>
          <strong>{{ formatMagnitude(flow.amount) }}</strong>
        </div>
      </div>

      <p v-if="!analysis.footprintCells.length" class="lens-note">
        This output has no mapxel-local footprint. National budget/account effects remain national instead of being assigned fake geography.
      </p>
    </section>

    <section class="downstream-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">COUNTERFACTUAL PROPAGATION</span>
          <h4>What actually changes if this rule does not run once?</h4>
        </div>
        <p>
          Unlike the direct-consumer graph above, this includes indirect effects. The same world is simulated twice; only this execution of <code>{{ analysis.ruleId }}</code> is removed.
        </p>
      </div>

      <div class="downstream-track">
        <article
          v-for="stage in analysis.downstream"
          :key="stage.key"
          class="downstream-node"
          :class="{ quiet: stage.impacts.length === 0 }"
        >
          <div class="downstream-node-head">
            <span>{{ stage.month }}</span>
            <strong>{{ stage.phase }}</strong>
          </div>
          <div class="downstream-meter">
            <i :style="{ width: `${Math.min(100, stage.magnitude * 4000)}%` }" />
          </div>
          <p><strong>{{ stage.changedCells }}</strong> mapxels diverge</p>
          <div class="downstream-impacts">
            <span v-for="impact in stage.impacts.slice(0, 3)" :key="impact.label">
              {{ impact.label }} <strong>{{ formatRelative(impact.relative) }}</strong>
            </span>
            <span v-if="!stage.impacts.length" class="no-impact">no model-state divergence</span>
          </div>
        </article>
      </div>
    </section>

    <details v-if="analysis.structuralInputs.length" class="structural-reads">
      <summary>Structural reads that are dependencies but not numeric gradients</summary>
      <span v-for="input in analysis.structuralInputs" :key="input.key">
        {{ input.label }} · {{ input.reads }} reads
      </span>
    </details>
  </section>
</template>