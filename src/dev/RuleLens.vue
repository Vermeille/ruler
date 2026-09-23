<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Game } from '../sim/types';
import type { PhaseTrace } from '../sim/trace';
import { analyzeRule, type JacobianCell } from './rule-analysis';
import './rule-lens.css';

const props = defineProps<{
  game: Game;
  phase: PhaseTrace;
  ruleId: string;
}>();

const CELL_SIZE = 28;
const analysis = computed(() => analyzeRule(props.game, props.phase, props.ruleId));
const selectedMatrixKey = ref('');
const selectedOutputKey = ref('');

watch(analysis, next => {
  selectedMatrixKey.value = next?.jacobian[0]?.key ?? '';
  selectedOutputKey.value = next?.outputs[0]?.key ?? '';
}, { immediate: true });

const matrixCell = computed(() => (
  analysis.value?.jacobian.find(cell => cell.key === selectedMatrixKey.value)
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

function jacobianCell(inputKey: string, outputKey: string): JacobianCell | undefined {
  return analysis.value?.jacobian.find(cell => (
    cell.inputKey === inputKey && cell.outputKey === outputKey
  ));
}

function matrixStyle(cell: JacobianCell | undefined): Record<string, string> {
  if (!cell || cell.strength <= 0.001) return { backgroundColor: 'rgba(92, 105, 128, 0.08)' };
  const alpha = 0.12 + cell.strength * 0.72;
  const rgb = cell.sign === 'positive'
    ? '75, 211, 163'
    : cell.sign === 'negative'
      ? '245, 112, 122'
      : '180, 130, 255';
  return { backgroundColor: `rgba(${rgb}, ${alpha})` };
}

function heatColor(id: number): string {
  const cell = props.phase.before.cells[id];
  if (cell.biome === 'water') return 'hsl(218 24% 11%)';
  const footprint = footprintByCell.value.get(id);
  if (!footprint) return 'hsl(219 19% 17%)';
  const selected = !selectedOutputKey.value || footprint.outputKeys.includes(selectedOutputKey.value);
  const strength = selected ? footprint.score : footprint.score * 0.12;
  const lightness = 22 + strength * 38;
  const saturation = 24 + strength * 48;
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
  return 0.8 + Math.sqrt(score) * 5.2;
}

function flowOpacity(score: number): number {
  return 0.25 + Math.sqrt(score) * 0.7;
}

function formatMagnitude(value: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(value) >= 1) return value.toFixed(2);
  if (Math.abs(value) >= 0.01) return value.toFixed(4);
  return value.toExponential(2);
}

function formatRelative(value: number): string {
  if (value <= 0) return '0%';
  if (value < 0.0001) return '<0.01%';
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function selectMatrix(cell: JacobianCell | undefined): void {
  if (!cell) return;
  selectedMatrixKey.value = cell.key;
  selectedOutputKey.value = cell.outputKey;
}
</script>

<template>
  <section v-if="analysis" class="rule-lens" aria-label="Rule causal explanation">
    <header class="rule-lens-header">
      <div>
        <span class="dev-kicker">CAUSAL LENS / {{ analysis.ruleId }}</span>
        <h3>Inputs → rule → outputs → downstream</h3>
        <p>{{ analysis.description }}</p>
      </div>
      <div class="analysis-sampling">
        <strong>{{ analysis.analyzedReads }}</strong>
        <span>local perturbations</span>
        <small>from {{ analysis.totalReads }} meaningful reads</small>
      </div>
    </header>

    <section class="jacobian-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">LOCAL JACOBIAN</span>
          <h4>Which inputs matter to which outputs, here?</h4>
        </div>
        <p>Each column is normalized to its strongest local input. Intensity is sensitivity; hue is direction.</p>
      </div>

      <div class="jacobian-scroll">
        <div
          class="jacobian-grid"
          :style="{ gridTemplateColumns: `minmax(180px, 1.4fr) repeat(${analysis.outputs.length}, minmax(86px, 1fr))` }"
        >
          <div class="jacobian-corner">actual reads</div>
          <button
            v-for="output in analysis.outputs"
            :key="`head-${output.key}`"
            class="output-head"
            :class="{ active: selectedOutputKey === output.key }"
            @click="selectedOutputKey = output.key"
          >
            <strong>{{ output.label }}</strong>
            <small>{{ output.effects }} channels</small>
          </button>

          <template v-for="input in analysis.inputs" :key="input.key">
            <div class="input-head">
              <strong>{{ input.label }}</strong>
              <small>{{ input.reads }} reads · {{ input.analyzed }} sampled</small>
            </div>
            <button
              v-for="output in analysis.outputs"
              :key="`${input.key}:${output.key}`"
              class="jacobian-tile"
              :class="{ active: selectedMatrixKey === `${input.key}→${output.key}` }"
              :style="matrixStyle(jacobianCell(input.key, output.key))"
              :aria-label="`${input.label} sensitivity to ${output.label}`"
              @click="selectMatrix(jacobianCell(input.key, output.key))"
            >
              <span v-if="jacobianCell(input.key, output.key)">
                {{ Math.round((jacobianCell(input.key, output.key)?.strength ?? 0) * 100) }}
              </span>
              <span v-else>·</span>
            </button>
          </template>
        </div>
      </div>

      <div v-if="matrixCell" class="jacobian-detail">
        <div>
          <span class="dev-kicker">STRONGEST LOCAL EXAMPLE</span>
          <strong>{{ matrixCell.example }}</strong>
          <small>{{ matrixCell.nudge }}</small>
        </div>
        <div class="jacobian-arrow">→</div>
        <div>
          <span class="dev-kicker">OUTPUT RESPONSE</span>
          <strong>{{ analysis.outputs.find(output => output.key === matrixCell?.outputKey)?.label }}</strong>
          <small>
            Δ {{ formatMagnitude(matrixCell.response) }} · local derivative {{ formatMagnitude(matrixCell.derivative) }}
          </small>
        </div>
      </div>

      <div class="matrix-legend">
        <span><i class="positive" /> increases output</span>
        <span><i class="negative" /> decreases output</span>
        <span><i class="mixed" /> mixed directions across channels</span>
        <span>0–100 = relative sensitivity within that output column</span>
      </div>
    </section>

    <section class="footprint-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">SPATIAL FOOTPRINT</span>
          <h4>Where does this rule act?</h4>
        </div>
        <div class="output-pills">
          <button
            v-for="output in analysis.outputs"
            :key="`pill-${output.key}`"
            :class="{ active: selectedOutputKey === output.key }"
            @click="selectedOutputKey = output.key"
          >
            {{ output.label }}
          </button>
        </div>
      </div>

      <div class="footprint-layout">
        <svg
          class="rule-footprint-map"
          :viewBox="`0 0 ${phase.before.width * CELL_SIZE} ${phase.before.height * CELL_SIZE}`"
          role="img"
          :aria-label="`${analysis.ruleId} spatial footprint`"
        >
          <defs>
            <marker id="rule-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          <rect
            v-for="cell in phase.before.cells"
            :key="cell.id"
            :x="cell.x * CELL_SIZE + 1"
            :y="cell.y * CELL_SIZE + 1"
            :width="CELL_SIZE - 2"
            :height="CELL_SIZE - 2"
            :fill="heatColor(cell.id)"
            class="footprint-cell"
          >
            <title>{{ cell.name }}</title>
          </rect>
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
          >
            <title>{{ flow.label }} · {{ formatMagnitude(flow.amount) }}</title>
          </line>
        </svg>

        <div class="output-summary-list">
          <button
            v-for="output in analysis.outputs"
            :key="`summary-${output.key}`"
            :class="{ active: selectedOutputKey === output.key }"
            @click="selectedOutputKey = output.key"
          >
            <span>{{ output.label }}</span>
            <strong>{{ formatMagnitude(output.magnitude) }}</strong>
            <small>{{ output.effects }} concrete channels</small>
          </button>
        </div>
      </div>
      <p class="lens-note">Heat shows relative activity by mapxel. Arrows appear automatically for cell-to-cell transfers and trades; delta-only and national rules remain heatmaps/cards instead of being forced into fake geography.</p>
    </section>

    <section class="downstream-card">
      <div class="lens-section-heading">
        <div>
          <span class="dev-kicker">COUNTERFACTUAL PROPAGATION</span>
          <h4>What stops happening if this rule does not run once?</h4>
        </div>
        <p>The same world is simulated twice. Only this execution of <code>{{ analysis.ruleId }}</code> is removed; later rules run normally.</p>
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