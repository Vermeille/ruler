<script setup lang="ts">
import { computed } from 'vue';
import { summarize } from '../sim/math';
import { SECTORS, type Game, type Sector } from '../sim/types';
import { formatNumber, formatPercent, label } from '../ui/format';
import { SECTOR_COLORS } from '../ui/map';

const props = defineProps<{
  game: Game;
  selected: Set<number>;
}>();

const emit = defineEmits<{
  clear: [];
  causes: [ids: string[]];
}>();

const ids = computed(() => [...props.selected]);
const summary = computed(() => summarize(props.game.model, ids.value.length ? ids.value : undefined));
const cell = computed(() => ids.value.length === 1 ? props.game.model.cells[ids.value[0]] : undefined);
const cells = computed(() => ids.value.length
  ? ids.value.map(id => props.game.model.cells[id])
  : props.game.model.cells.filter(candidate => candidate.population > 0));
const latest = computed(() => props.game.causes
  .filter(cause => !ids.value.length || cause.cells.some(id => props.selected.has(id)))
  .slice(-1)[0]);

function sectorMean(key: Sector): number {
  return cells.value.reduce(
    (total, candidate) => total + candidate[key] * candidate.population,
    0,
  ) / Math.max(1, summary.value.population);
}

const title = computed(() => cell.value
  ? cell.value.name
  : ids.value.length
    ? `${ids.value.length} mapxels selected`
    : 'Many places. One country.');

const description = computed(() => cell.value
  ? `${props.game.model.regions[cell.value.region]} · ${label(cell.value.biome)} · Mapxel ${cell.value.id}`
  : ids.value.length
    ? 'Population-weighted conditions across your selected area.'
    : 'Click a mapxel to meet a neighborhood, or drag across the map to inspect a region.');
</script>

<template>
  <aside class="panel inspector">
    <div class="inspector-head">
      <span class="eyebrow">{{ ids.length ? 'LOCAL INTELLIGENCE' : 'THE NATIONAL PICTURE' }}</span>
      <button v-if="ids.length" id="clear-selection" class="text-button" @click="emit('clear')">Clear ×</button>
      <span v-else class="tiny-seal">◎</span>
    </div>

    <h2>{{ title }}</h2>
    <p class="muted inspector-description">{{ description }}</p>

    <div class="selection-stat">
      <strong>{{ formatNumber(summary.population) }}</strong>
      <span>
        residents<span v-if="cell"> · {{ formatPercent(cell.children) }} children · {{ formatPercent(cell.seniors) }} seniors</span>
      </span>
    </div>

    <div class="inspector-grid">
      <div><span>Approval</span><strong>{{ formatPercent(summary.approval) }}</strong></div>
      <div><span>Wellbeing</span><strong>{{ formatPercent(summary.happiness) }}</strong></div>
      <div><span>Reserves / person</span><strong>₡{{ summary.wealth.toFixed(1) }}</strong></div>
      <div><span>Employment</span><strong>{{ formatPercent(summary.employment) }}</strong></div>
      <div><span>Food needs met</span><strong>{{ formatPercent(summary.foodSecurity) }}</strong></div>
      <div><span>Crime pressure</span><strong>{{ formatPercent(summary.crime) }}</strong></div>
    </div>

    <div class="industry-heading"><span class="eyebrow">HOW PEOPLE MAKE A LIVING</span></div>
    <div class="industry-bar">
      <span
        v-for="sector in SECTORS"
        :key="sector"
        :style="{ width: `${sectorMean(sector) * 100}%`, background: SECTOR_COLORS[sector] }"
        :title="`${sector}: ${formatPercent(sectorMean(sector))}`"
      />
    </div>
    <div class="industry-key">
      <span v-for="sector in SECTORS" :key="sector">
        <i :style="{ background: SECTOR_COLORS[sector] }" />{{ label(sector) }} <b>{{ formatPercent(sectorMean(sector)) }}</b>
      </span>
    </div>

    <details v-if="cell" class="local-details">
      <summary>Resources & living conditions</summary>
      <div class="inspector-grid">
        <div><span>Fertility</span><strong>{{ formatPercent(cell.fertility) }}</strong></div>
        <div><span>Minerals</span><strong>{{ formatPercent(cell.minerals) }}</strong></div>
        <div><span>Health</span><strong>{{ formatPercent(cell.health) }}</strong></div>
        <div><span>Education</span><strong>{{ formatPercent(cell.education) }}</strong></div>
        <div><span>Transport</span><strong>{{ formatPercent(cell.infrastructure) }}</strong></div>
        <div><span>Pollution</span><strong>{{ formatPercent(cell.pollution) }}</strong></div>
        <div><span>Food stored</span><strong>{{ (cell.food / cell.population).toFixed(1) }} months</strong></div>
        <div><span>Net food trade</span><strong>{{ cell.foodTraded > 0 ? '+' : '' }}{{ formatNumber(cell.foodTraded) }} units</strong></div>
        <div><span>Food price</span><strong>₡{{ cell.price.toFixed(2) }}</strong></div>
        <div><span>Sports interest</span><strong>{{ formatPercent(cell.sportsInterest) }}</strong></div>
      </div>
    </details>

    <div class="field-note">
      <span class="eyebrow">{{ latest ? 'A RECENT CONSEQUENCE' : 'YOUR FIRST FIELD NOTE' }}</span>
      <p>{{ latest ? latest.title : 'A prosperous neighbor can be an opportunity, a trading partner, or a source of resentment. Geography matters.' }}</p>
      <button v-if="latest" class="text-button" @click="emit('causes', [latest.id])">Follow the story <span>↗</span></button>
      <span v-else class="muted">The country evolves one month at a time.</span>
    </div>
  </aside>
</template>
