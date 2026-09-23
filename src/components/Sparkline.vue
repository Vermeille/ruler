<script setup lang="ts">
import { computed } from 'vue';
import type { Game, Metric } from '../sim/types';

const props = withDefaults(defineProps<{
  game: Game;
  metric: Metric;
  width?: number;
  height?: number;
  stroke?: string;
}>(), {
  width: 90,
  height: 26,
  stroke: '#39755d',
});

const points = computed(() => {
  const values = props.game.history.map(entry => entry.summary[props.metric]);
  if (values.length === 1) values.push(values[0]);

  const low = Math.min(...values) * 0.98;
  const high = Math.max(...values) * 1.02 + 0.0001;

  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * props.width;
    const y = props.height - 3 - ((value - low) / (high - low)) * (props.height - 6);
    return `${x},${y}`;
  }).join(' ');
});
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    :aria-label="`${metric} trend`"
    role="img"
  >
    <polyline
      fill="none"
      :stroke="stroke"
      stroke-width="1.8"
      :points="points"
    />
  </svg>
</template>
