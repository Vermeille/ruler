<script setup lang="ts">
import type { Game } from '../sim/types';
import { formatMonth } from '../ui/format';

defineProps<{
  game: Game;
  running: boolean;
  speed: number;
}>();

const emit = defineEmits<{
  advance: [];
  toggle: [];
  speed: [value: number];
}>();

function updateSpeed(event: Event): void {
  emit('speed', Number((event.target as HTMLSelectElement).value));
}
</script>

<template>
  <section class="page-heading">
    <div>
      <div class="eyebrow">THE COMMONWEALTH · OFFICE OF THE PRIME MINISTER</div>
      <h1>A country in your hands.</h1>
      <p>Watch closely. Govern thoughtfully. See what happens.</p>
    </div>

    <div class="time-controls">
      <div class="date">
        <strong>{{ formatMonth(game.model.tick) }}</strong>
        <span>{{ Math.min(game.model.tick, game.model.mandate) }} of {{ game.model.mandate }} months served</span>
      </div>
      <div class="time-buttons">
        <select id="speed" aria-label="Simulation speed" :value="speed" @change="updateSpeed">
          <option :value="1">1×</option>
          <option :value="2">2×</option>
          <option :value="4">4×</option>
        </select>
        <button
          id="play"
          class="play"
          :disabled="game.ended"
          :aria-label="`${running ? 'Pause' : 'Play'} simulation`"
          @click="$emit('toggle')"
        >
          {{ running ? 'Ⅱ' : '▶' }}
        </button>
        <button id="advance" class="primary" :disabled="game.ended" @click="$emit('advance')">
          Next month <span>→</span>
        </button>
      </div>
    </div>
  </section>
</template>
