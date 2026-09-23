<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '../sim/types';
import type { PhaseTrace } from '../sim/trace';
import { analyzeRule, type JacobianCell } from './rule-analysis';
import {
  analyzeRuleInfluence,
  analyzeRuleInputInfluence,
  type RuleConsumer,
  type RuleProducer,
} from './rule-influence';
import RuleGraph from './RuleGraph.vue';
import './rule-lens.css';

const props = defineProps<{
  game: Game;
  phase: PhaseTrace;
  ruleId: string;
}>();

const emit = defineEmits<{
  navigateRule: [target: {
    ruleId: string;
    phase: string;
    monthDelta: number;
    via: string;
  }];
}>();

const CELL_SIZE = 28;
const analysis = computed(() => analyzeRule(props.game, props.phase, props.ruleId));
const selectedOutputKey = ref('');
const selectedSensitivityKey = ref('');
const selectedInputKey = ref('');

const selectedOutput = computed(() => (
  analysis.value?.outputs.find(output => output.key === selectedOutputKey.value)
));

const influence = computed(() => analyzeRuleInfluence(
  props.game,
  props.phase,
  props.ruleId,
  selectedOutputKey.value,
));

const selectedInputInfluence = computed(() => (
  selectedInputKey.value
    ? analyzeRuleInputInfluence(
        props.game,
        props.phase,
        props.ruleId,
        selectedInputKey.value,
      )
    : undefined
));

const selectedInputLabel = computed(() => (
  analysis.value?.inputs.find(input => input.key === selectedInputKey.value)?.label
    ?? selectedInputKey.value
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
  selectedInputKey.value = '';
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

function navigateConsumer(consumer: RuleConsumer): void {
  emit('navigateRule', {
    ruleId: consumer.ruleId,
    phase: consumer.phase,
    monthDelta: consumer.month === 'next month' ? 1 : 0,
    via: `${consumer.month} consumer`,
  });
}

function navigateProducer(producer: RuleProducer): void {
  emit('navigateRule', {
    ruleId: producer.ruleId,
    phase: producer.phase,
    monthDelta: producer.month === 'previous month' ? -1 : 0,
    via: `${producer.month} producer`,
  });
}

function inspectInput(inputKey: string): void {
  selectedInputKey.value = inputKey;
  const upstream = analyzeRuleInputInfluence(
    props.game,
    props.phase,
    props.ruleId,
    inputKey,
  );
  if (upstream.producers.length === 1) navigateProducer(upstream.producers[0]);
}
</script>

<template>
  <section v-if="analysis" class="rule-lens" aria-label="Rule causal explanation">
    <header class="rule-lens-header">
      <div>
        <span class="dev-kicker">CAUSAL LENS / {{ analysis.ruleId }}</span>
        <h3>Inspect the rule as a node in the engine.</h3>
        <p>{{ analysis.description }}</p>
      </div>
      <div class="analysis-sampling">
        <strong>{{ analysis.analyzedReads }}</strong>
        <span>local perturbations</span>
        <small>from {{ analysis.totalReads }} meaningful reads</small>
      </div>
    </header>

    <RuleGraph
      :analysis="analysis"
      :influence="influence"
      :selected-output-key="selectedOutputKey"
      :selected-sensitivity-key="selectedSensitivityKey"
      @select-output="selectedOutputKey = $event"
      @select-sensitivity="selectedSensitivityKey = $event"
      @inspect-input="inspectInput"
      @navigate-rule="navigateConsumer"
    />

    <section
      v-if="selectedInputKey && selectedInputInfluence && selectedInputInfluence.producers.length !== 1"
      class="sensitivity-card"
      aria-label="Upstream producers"
    >
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">UPSTREAM / {{ selectedInputLabel }}</span>
          <h4 v-if="selectedInputInfluence.producers.length">Which writer do you want to inspect?</h4>
          <h4 v-else>No traced rule writes this input.</h4>
        </div>
        <p v-if="selectedInputInfluence.producers.length">
          Several rules write exact state paths read by this input group. Pick one to recenter the graph.
        </p>
        <p v-else>
          This value is exogenous, random, structural, or carried from state for which no writer emitted a matching effect in the traced cycle.
        </p>
      </div>

      <div v-if="selectedInputInfluence.producers.length" class="rule-tabs" role="list" aria-label="Input producer rules">
        <button
          v-for="producer in selectedInputInfluence.producers"
          :key="producer.key"
          type="button"
          @click="navigateProducer(producer)"
        >
          {{ producer.ruleId }}
          <span>{{ producer.month }} · {{ Math.round(producer.strength * 100) }}%</span>
        </button>
      </div>
    </section>

    <details class="causal-details">
      <summary>
        Numerical sensitivity details
        <span v-if="selectedOutput">for {{ selectedOutput.label }}</span>
      </summary>

      <section class="sensitivity-card">
        <div class="lens-section-heading">
          <div>
            <span class="dev-kicker">LOCAL SENSITIVITY</span>
            <h4 v-if="selectedOutput">Why are those input edges thick or thin?</h4>
            <h4 v-else>What did this rule read before emitting nothing?</h4>
          </div>
          <p v-if="selectedOutput">
            A small local nudge is applied to sampled reads, then the same rule runs again.
            100 is the strongest sampled local derivative for this selected output.
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
      </section>
    </details>

    <section class="footprint-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">MAP WRITES</span>
          <h4>Where does the selected output modify map state?</h4>
        </div>
        <p>
          This is not a population, wealth, or forecast map. Bright cells simply mean this rule writes more strongly there in this execution. Arrows are literal transfers or trades between mapxels.
        </p>
      </div>

      <div class="footprint-key">
        <span><i class="footprint-low" /> little or no write activity</span>
        <span><i class="footprint-high" /> stronger write activity</span>
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
        This output has no mapxel-local writes. National budget/account effects remain national instead of being assigned fake geography.
      </p>
    </section>

    <section class="downstream-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">COUNTERFACTUAL PROPAGATION</span>
          <h4>What actually changes if this rule does not run once?</h4>
        </div>
        <p>
          The graph above shows direct reads of this rule's writes. This section includes indirect consequences too: the same world is simulated twice, with only this rule execution removed from one branch.
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