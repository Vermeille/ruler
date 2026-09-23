<script setup lang="ts">
import { computed } from 'vue';
import type { JacobianCell, RuleAnalysis } from './rule-analysis';
import type { RuleConsumer, RuleInfluence } from './rule-influence';
import './rule-graph.css';

const props = defineProps<{
  analysis: RuleAnalysis;
  influence: RuleInfluence;
  selectedOutputKey: string;
  selectedSensitivityKey: string;
}>();

const emit = defineEmits<{
  selectOutput: [key: string];
  selectSensitivity: [key: string];
  inspectInput: [key: string];
  navigateRule: [consumer: RuleConsumer];
}>();

const GRAPH_WIDTH = 1360;
const INPUT_X = 24;
const INPUT_WIDTH = 230;
const RULE_X = 430;
const RULE_WIDTH = 250;
const RULE_HEIGHT = 96;
const OUTPUT_X = 790;
const OUTPUT_WIDTH = 220;
const CONSUMER_X = 1120;
const CONSUMER_WIDTH = 215;
const NODE_HEIGHT = 44;
const MAX_GRAPH_INPUTS = 8;
const MAX_GRAPH_CONSUMERS = 8;

interface GraphInput {
  key: string;
  label: string;
  reads: number;
  sensitivity?: JacobianCell;
}

const graphInputs = computed<GraphInput[]>(() => {
  const rows = props.analysis.inputs.map(input => ({
    key: input.key,
    label: input.label,
    reads: input.reads,
    sensitivity: props.analysis.jacobian.find(cell => (
      cell.inputKey === input.key && cell.outputKey === props.selectedOutputKey
    )),
  }));

  const responsive = rows.filter(row => row.sensitivity)
    .sort((left, right) => (
      (right.sensitivity?.strength ?? 0) - (left.sensitivity?.strength ?? 0)
    ));

  if (responsive.length) return responsive.slice(0, MAX_GRAPH_INPUTS);
  return rows.sort((left, right) => right.reads - left.reads).slice(0, MAX_GRAPH_INPUTS);
});

const graphOutputs = computed(() => props.analysis.outputs);

const graphConsumers = computed<RuleConsumer[]>(() => (
  props.influence.consumers
    .filter(consumer => !consumer.self)
    .sort((left, right) => (
      Number(left.month === 'next month') - Number(right.month === 'next month')
        || right.strength - left.strength
        || left.ruleId.localeCompare(right.ruleId)
    ))
    .slice(0, MAX_GRAPH_CONSUMERS)
));

const feedback = computed(() => (
  props.influence.consumers
    .filter(consumer => consumer.self && consumer.month === 'next month')
    .sort((left, right) => right.strength - left.strength)[0]
));

const graphHeight = computed(() => {
  const lanes = Math.max(
    graphInputs.value.length,
    graphOutputs.value.length,
    graphConsumers.value.length,
    6,
  );
  return Math.max(500, 130 + lanes * 58);
});

const ruleY = computed(() => (graphHeight.value - RULE_HEIGHT) / 2);
const ruleCenterY = computed(() => ruleY.value + RULE_HEIGHT / 2);
const maxOutputChannels = computed(() => Math.max(
  1,
  ...graphOutputs.value.map(output => output.effects),
));

function laneY(index: number, count: number, height = NODE_HEIGHT): number {
  const top = 62;
  const bottom = 62;
  const usable = graphHeight.value - top - bottom;
  const lane = usable / Math.max(1, count);
  return top + lane * (index + 0.5) - height / 2;
}

function inputPath(index: number): string {
  const y = laneY(index, graphInputs.value.length) + NODE_HEIGHT / 2;
  return `M ${INPUT_X + INPUT_WIDTH} ${y} C 330 ${y}, 350 ${ruleCenterY.value}, ${RULE_X} ${ruleCenterY.value}`;
}

function outputPath(index: number): string {
  const y = laneY(index, graphOutputs.value.length) + NODE_HEIGHT / 2;
  return `M ${RULE_X + RULE_WIDTH} ${ruleCenterY.value} C 730 ${ruleCenterY.value}, 742 ${y}, ${OUTPUT_X} ${y}`;
}

function consumerPath(index: number): string {
  const outputIndex = Math.max(
    0,
    graphOutputs.value.findIndex(output => output.key === props.selectedOutputKey),
  );
  const sourceY = laneY(outputIndex, graphOutputs.value.length) + NODE_HEIGHT / 2;
  const targetY = laneY(index, graphConsumers.value.length) + NODE_HEIGHT / 2;
  return `M ${OUTPUT_X + OUTPUT_WIDTH} ${sourceY} C 1050 ${sourceY}, 1060 ${targetY}, ${CONSUMER_X} ${targetY}`;
}

function feedbackPath(): string {
  const outputIndex = Math.max(
    0,
    graphOutputs.value.findIndex(output => output.key === props.selectedOutputKey),
  );
  const sourceY = laneY(outputIndex, graphOutputs.value.length) + NODE_HEIGHT / 2;
  const targetX = RULE_X + RULE_WIDTH * 0.62;
  const targetY = ruleY.value;
  return [
    `M ${OUTPUT_X + OUTPUT_WIDTH} ${sourceY}`,
    `C 1080 ${sourceY}, 1080 28, 835 28`,
    `C 665 28, ${targetX} 28, ${targetX} ${targetY}`,
  ].join(' ');
}

function inputStroke(cell: JacobianCell | undefined): string {
  if (!cell) return '#445064';
  switch (cell.sign) {
    case 'positive': return '#55d6a7';
    case 'negative': return '#f5707a';
    case 'mixed': return '#b482ff';
    case 'none': return '#5f6f87';
  }
}

function inputMarker(cell: JacobianCell | undefined): string {
  if (!cell) return 'url(#graph-arrow-neutral)';
  return `url(#graph-arrow-${cell.sign})`;
}

function inputWidth(cell: JacobianCell | undefined): number {
  return cell ? 1.5 + Math.sqrt(cell.strength) * 9 : 1.25;
}

function outputWidth(effects: number): number {
  return 2 + Math.sqrt(effects / maxOutputChannels.value) * 7;
}

function consumerWidth(consumer: RuleConsumer): number {
  return 1.5 + Math.sqrt(consumer.strength) * 8;
}

function shortLabel(value: string, length = 30): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

function outputValue(key: string): string {
  const output = props.analysis.outputs.find(candidate => candidate.key === key);
  if (!output) return '';
  if (Math.abs(output.magnitude) >= 1000) {
    return output.magnitude.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  if (Math.abs(output.magnitude) >= 1) return output.magnitude.toFixed(2);
  return output.magnitude.toPrecision(3);
}

function selectInput(row: GraphInput): void {
  if (row.sensitivity) emit('selectSensitivity', row.sensitivity.key);
  emit('inspectInput', row.key);
}
</script>

<template>
  <section class="rule-graph-card" aria-label="Rule influence graph">
    <div class="lens-section-heading rule-graph-heading">
      <div>
        <span class="dev-kicker">RULE GRAPH</span>
        <h4>What feeds this rule, and what does it feed?</h4>
      </div>
      <p>
        Input edges show the local gradient for the selected output. Click an input or consumer to recenter the graph on the related rule in this current month. Time labels still describe the relationship; they do not move the inspector through time.
      </p>
    </div>

    <div class="rule-graph-scroll">
      <svg
        class="rule-graph"
        :viewBox="`0 0 ${GRAPH_WIDTH} ${graphHeight}`"
        :style="{ minHeight: `${Math.min(760, graphHeight * 0.66)}px` }"
        role="img"
        :aria-label="`Causal graph for ${analysis.ruleId}`"
      >
        <defs>
          <marker id="graph-arrow-positive" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#55d6a7" />
          </marker>
          <marker id="graph-arrow-negative" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f5707a" />
          </marker>
          <marker id="graph-arrow-mixed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#b482ff" />
          </marker>
          <marker id="graph-arrow-none" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#5f6f87" />
          </marker>
          <marker id="graph-arrow-neutral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#445064" />
          </marker>
          <marker id="graph-arrow-output" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#58c9da" />
          </marker>
          <marker id="graph-arrow-next" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#d3a45d" />
          </marker>
          <marker id="graph-arrow-feedback" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#b482ff" />
          </marker>
        </defs>

        <text class="graph-column-label" :x="INPUT_X" y="28">INPUTS · LOCAL GRADIENT</text>
        <text class="graph-column-label" :x="RULE_X + RULE_WIDTH / 2" y="28" text-anchor="middle">CURRENT RULE</text>
        <text class="graph-column-label" :x="OUTPUT_X" y="28">OUTPUTS</text>
        <text class="graph-column-label" :x="CONSUMER_X" y="28">DIRECT CONSUMERS</text>

        <g class="graph-input-edges">
          <path
            v-for="(row, index) in graphInputs"
            :key="`input-edge:${row.key}`"
            class="rule-graph-edge rule-graph-edge-input"
            :class="{ selected: row.sensitivity?.key === selectedSensitivityKey }"
            :d="inputPath(index)"
            fill="none"
            :stroke="inputStroke(row.sensitivity)"
            :stroke-width="inputWidth(row.sensitivity)"
            :marker-end="inputMarker(row.sensitivity)"
          />
        </g>

        <g class="graph-output-edges">
          <path
            v-for="(output, index) in graphOutputs"
            :key="`output-edge:${output.key}`"
            class="rule-graph-edge rule-graph-edge-output"
            :class="{ selected: output.key === selectedOutputKey }"
            :d="outputPath(index)"
            fill="none"
            stroke="#58c9da"
            :stroke-width="outputWidth(output.effects)"
            marker-end="url(#graph-arrow-output)"
          />
        </g>

        <g class="graph-consumer-edges">
          <path
            v-for="(consumer, index) in graphConsumers"
            :key="`consumer-edge:${consumer.key}`"
            class="rule-graph-edge rule-graph-edge-consumer"
            :class="{ next: consumer.month === 'next month' }"
            :d="consumerPath(index)"
            fill="none"
            :stroke="consumer.month === 'next month' ? '#d3a45d' : '#7acddd'"
            :stroke-width="consumerWidth(consumer)"
            :marker-end="consumer.month === 'next month' ? 'url(#graph-arrow-next)' : 'url(#graph-arrow-output)'"
          />
        </g>

        <g v-if="feedback" class="graph-feedback">
          <path
            class="rule-graph-edge rule-graph-feedback-edge"
            :d="feedbackPath()"
            fill="none"
            stroke="#b482ff"
            :stroke-width="consumerWidth(feedback)"
            stroke-dasharray="8 5"
            marker-end="url(#graph-arrow-feedback)"
          />
          <text class="graph-feedback-label" x="835" y="20" text-anchor="middle">
            t → t+1 feedback · {{ Math.round(feedback.strength * 100) }}% of writes reread
          </text>
        </g>

        <g
          v-for="(row, index) in graphInputs"
          :key="`input:${row.key}`"
          class="rule-graph-node rule-graph-node-input"
          :class="{
            selected: row.sensitivity?.key === selectedSensitivityKey,
            inert: !row.sensitivity,
          }"
          :transform="`translate(${INPUT_X} ${laneY(index, graphInputs.length)})`"
          role="button"
          tabindex="0"
          @click="selectInput(row)"
          @keydown.enter.prevent="selectInput(row)"
          @keydown.space.prevent="selectInput(row)"
        >
          <title>{{ row.label }}</title>
          <rect :width="INPUT_WIDTH" :height="NODE_HEIGHT" rx="8" />
          <text x="12" y="18" class="graph-node-title">{{ shortLabel(row.label, 29) }}</text>
          <text x="12" y="34" class="graph-node-meta">
            {{ row.sensitivity ? `${Math.round(row.sensitivity.strength * 100)} gradient` : `${row.reads} reads · no local response` }}
          </text>
        </g>

        <g
          class="rule-graph-node rule-graph-node-rule"
          :transform="`translate(${RULE_X} ${ruleY})`"
        >
          <rect :width="RULE_WIDTH" :height="RULE_HEIGHT" rx="16" />
          <text :x="RULE_WIDTH / 2" y="28" text-anchor="middle" class="graph-rule-kicker">INSPECTING</text>
          <text :x="RULE_WIDTH / 2" y="52" text-anchor="middle" class="graph-rule-title">{{ shortLabel(analysis.ruleId, 29) }}</text>
          <text :x="RULE_WIDTH / 2" y="73" text-anchor="middle" class="graph-rule-meta">
            {{ selectedOutputKey ? `gradient wrt ${shortLabel(analysis.outputs.find(output => output.key === selectedOutputKey)?.label ?? '', 23)}` : analysis.phase }}
          </text>
        </g>

        <g
          v-for="(output, index) in graphOutputs"
          :key="`output:${output.key}`"
          class="rule-graph-node rule-graph-node-output"
          :class="{ selected: output.key === selectedOutputKey }"
          :transform="`translate(${OUTPUT_X} ${laneY(index, graphOutputs.length)})`"
          role="button"
          tabindex="0"
          @click="emit('selectOutput', output.key)"
          @keydown.enter.prevent="emit('selectOutput', output.key)"
          @keydown.space.prevent="emit('selectOutput', output.key)"
        >
          <title>{{ output.label }} · {{ output.effects }} channels · magnitude {{ output.magnitude }}</title>
          <rect :width="OUTPUT_WIDTH" :height="NODE_HEIGHT" rx="8" />
          <text x="12" y="18" class="graph-node-title">{{ shortLabel(output.label, 27) }}</text>
          <text x="12" y="34" class="graph-node-meta">{{ output.effects }} channels · {{ outputValue(output.key) }}</text>
        </g>

        <g
          v-for="(consumer, index) in graphConsumers"
          :key="`consumer:${consumer.key}`"
          class="rule-graph-node rule-graph-node-consumer"
          :class="{ next: consumer.month === 'next month' }"
          :transform="`translate(${CONSUMER_X} ${laneY(index, graphConsumers.length)})`"
          role="button"
          tabindex="0"
          @click="emit('navigateRule', consumer)"
          @keydown.enter.prevent="emit('navigateRule', consumer)"
          @keydown.space.prevent="emit('navigateRule', consumer)"
        >
          <title>{{ consumer.ruleId }} reads {{ consumer.paths.map(path => path.label).join(', ') }}</title>
          <rect :width="CONSUMER_WIDTH" :height="NODE_HEIGHT" rx="8" />
          <text x="12" y="18" class="graph-node-title">{{ shortLabel(consumer.ruleId, 27) }}</text>
          <text x="12" y="34" class="graph-node-meta">
            {{ consumer.month === 'next month' ? 't+1' : 'same month' }} · {{ consumer.phase }} · {{ Math.round(consumer.strength * 100) }}%
          </text>
        </g>
      </svg>
    </div>

    <div class="rule-graph-legend">
      <span><i class="positive" /> positive input gradient</span>
      <span><i class="negative" /> negative input gradient</span>
      <span><i class="mixed" /> mixed gradient</span>
      <span><i class="same-month" /> same-month direct consumer</span>
      <span><i class="next-month" /> next-month relationship; click inspects current value</span>
      <span><i class="feedback" /> recurrent self-dependency</span>
      <small>Input width = normalized local derivative · output width = emitted channel breadth · consumer width = share of exact written paths reread</small>
    </div>
  </section>
</template>