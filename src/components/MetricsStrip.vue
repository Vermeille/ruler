<script setup lang="ts">
import { computed } from 'vue';
import { summarize } from '../sim/math';
import { forecastBudget } from '../sim/policy';
import type { Game, Metric } from '../sim/types';
import { formatCompact, formatMoney, formatNumber, formatPercent } from '../ui/format';
import Sparkline from './Sparkline.vue';

const props = defineProps<{ game: Game }>();

const summary = computed(() => summarize(props.game.model));
const forecast = computed(() => forecastBudget(props.game.model));
const inhabited = computed(() => props.game.model.cells.filter(cell => cell.population > 0).length);

interface Card {
  name: string;
  value: string;
  detail: string;
  metric?: Metric;
}

const cards = computed<Card[]>(() => [
  {
    name: 'PUBLIC APPROVAL',
    value: formatPercent(summary.value.approval),
    detail: summary.value.approval >= 0.5 ? 'A majority is with you' : 'Public confidence is fragile',
    metric: 'approval',
  },
  {
    name: 'THE PEOPLE',
    value: formatCompact(summary.value.population),
    detail: `${formatNumber(inhabited.value)} inhabited mapxels`,
    metric: 'population',
  },
  {
    name: 'PUBLIC TREASURY',
    value: formatMoney(summary.value.treasury),
    detail: `${forecast.value.balance >= 0 ? '+' : '−'}₡${formatCompact(Math.abs(forecast.value.balance))} projected / month`,
  },
  {
    name: 'HOUSEHOLD WELLBEING',
    value: formatPercent(summary.value.happiness),
    detail: `${formatPercent(summary.value.employment)} employment`,
    metric: 'happiness',
  },
  {
    name: 'FOOD NEEDS MET',
    value: formatPercent(summary.value.foodSecurity),
    detail: `${summary.value.price.toFixed(2)}× food price index`,
    metric: 'foodSecurity',
  },
]);
</script>

<template>
  <section class="metrics" aria-label="National indicators">
    <div v-for="card in cards" :key="card.name" class="metric">
      <span class="eyebrow">{{ card.name }}</span>
      <div class="metric-main">
        <strong>{{ card.value }}</strong>
        <Sparkline v-if="card.metric" :game="game" :metric="card.metric" />
        <span v-else class="currency-seal">₡</span>
      </div>
      <span class="metric-note">{{ card.detail }}</span>
    </div>
  </section>
</template>
