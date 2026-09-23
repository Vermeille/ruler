<script setup lang="ts">
import { computed } from 'vue';
import type { Game } from '../sim/types';
import { formatMonth, label } from '../ui/format';

const props = defineProps<{
  game: Game;
  feedFilter: string;
}>();

const emit = defineEmits<{
  'update:feedFilter': [value: string];
  causes: [ids: string[]];
  locate: [cell: number];
}>();

const filters = ['all', 'dispatch', 'economy', 'politics', 'culture', 'briefing'] as const;
const articles = computed(() => props.game.articles.filter(
  article => props.feedFilter === 'all' || article.category === props.feedFilter,
));

function updateFilter(event: Event): void {
  emit('update:feedFilter', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="ledger-heading">
    <div><span class="eyebrow">INDEPENDENT VOICES. A SHARED STORY.</span><h2>The Commonwealth Ledger</h2><p>Reports from the places behind the numbers.</p></div>
    <select id="feed-filter" aria-label="Filter news" :value="feedFilter" @change="updateFilter">
      <option v-for="value in filters" :key="value" :value="value">{{ value === 'all' ? 'All stories' : label(value) }}</option>
    </select>
  </div>

  <div class="news-grid">
    <article v-for="article in articles.slice(0, 60)" :key="article.id" class="news-card">
      <div class="article-meta"><span class="category" :class="article.tone">{{ article.category }}</span><time>{{ formatMonth(article.tick) }}</time></div>
      <h3>{{ article.headline }}</h3>
      <p>{{ article.body }}</p>
      <div class="byline">{{ article.voice }}</div>
      <div class="news-actions">
        <button v-if="article.causeIds.length" class="text-button" @click="emit('causes', article.causeIds)">Follow the causes ↗</button>
        <span v-else class="muted">Your story is just beginning.</span>
        <button v-if="article.cell !== undefined" class="text-button" @click="emit('locate', article.cell)">Locate on map ⌖</button>
      </div>
    </article>
    <p v-if="!articles.length" class="empty">No reports in this section yet. Advance the country a few months.</p>
  </div>

  <p class="small muted">
    Dispatches use predefined text grounded in simulation events. Voices are fictional.
    <template v-if="articles.length > 60"> Showing the 60 latest of {{ articles.length }} reports; the complete archive is retained in your save.</template>
  </p>
</template>
