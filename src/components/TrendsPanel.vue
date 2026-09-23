<script setup lang="ts">
import { computed } from 'vue';
import { summarize } from '../sim/math';
import type { Game, Metric } from '../sim/types';
import { formatMoney, formatMonth, formatPercent } from '../ui/format';
import Sparkline from './Sparkline.vue';

const props = defineProps<{ game: Game }>();
defineEmits<{ exportData: [] }>();

const charts: readonly [Metric, string, boolean][] = [
  ['approval', 'Public approval', true],
  ['happiness', 'Household wellbeing', true],
  ['foodSecurity', 'Food needs met', true],
  ['crime', 'Crime pressure', true],
  ['wealth', 'Private reserves / person', false],
  ['output', 'Monthly economic output', false],
];

const summary = computed(() => summarize(props.game.model));

function display(metric: Metric, percent: boolean): string {
  return percent ? formatPercent(summary.value[metric]) : formatMoney(summary.value[metric]);
}

function range(metric: Metric, percent: boolean): string {
  const values = props.game.history.map(entry => entry.summary[metric]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return `${percent ? formatPercent(low) : formatMoney(low)} – ${percent ? formatPercent(high) : formatMoney(high)}`;
}
</script>

<template>
  <div class="section-intro">
    <div><span class="eyebrow">A COUNTRY OVER TIME</span><h2>The national accounts</h2><p>Population-weighted living conditions, measured every month.</p></div>
    <button id="export-data" class="outline" @click="$emit('exportData')">Export monthly data ↓</button>
  </div>

  <div class="trend-grid">
    <div v-for="[metric, name, percent] in charts" :key="metric" class="trend-card">
      <span class="eyebrow">{{ name }}</span>
      <strong>{{ display(metric, percent) }}</strong>
      <Sparkline :game="game" :metric="metric" :width="350" :height="90" :stroke="metric === 'crime' ? '#b38368' : '#39755d'" />
      <div class="chart-axis"><span>{{ formatMonth(0) }}</span><span>{{ formatMonth(game.model.tick) }}</span></div>
      <small>Range: {{ range(metric, percent) }}</small>
    </div>
  </div>
</template>
