<script setup lang="ts">
import { computed } from 'vue';
import { mandateReport } from '../../sim/narrative';
import type { Game } from '../../sim/types';
import { download } from '../../ui/download';
import { formatMoney, formatMonth, formatNumber, formatPercent } from '../../ui/format';
import BaseModal from './BaseModal.vue';

const props = defineProps<{ game: Game }>();
const emit = defineEmits<{ close: []; newCountry: [] }>();
const report = computed(() => mandateReport(props.game));

function formatChange(value: number, unit: string): string {
  if (unit === 'percent') return formatPercent(value);
  if (unit === 'money') return formatMoney(value);
  return formatNumber(value);
}

function reportMarkdown(): string {
  const value = report.value;
  return `# ${value.title}\n\n${value.verdict}\n\n${value.opening}\n\n${value.voices.map(voice => `## ${voice.who}\n\n${voice.text}\n\n${voice.metric}`).join('\n\n')}\n\n## National record\n\n${value.changes.map(change => `- ${change.label}: ${change.before.toFixed(3)} → ${change.after.toFixed(3)} (${change.unit})`).join('\n')}\n\n## The long threads\n\n${value.chains.map(chain => `### ${chain.title}\n\n${chain.causes.map(cause => `- ${formatMonth(cause.tick)}: ${cause.title}. ${cause.detail} [${cause.id}; parents: ${cause.parents.join(', ')}]`).join('\n')}`).join('\n\n')}\n\n## Dispatches\n\n${value.moments.map(article => `### ${formatMonth(article.tick)}: ${article.headline}\n\n${article.body}`).join('\n\n')}\n\n${value.closing}\n`;
}

function exportReport(): void {
  download('commonwealth-mandate.md', reportMarkdown(), 'text/markdown');
}
</script>

<template>
  <BaseModal :title="report.title" wide @close="emit('close')">
    <div class="report-intro">
      <span class="eyebrow">{{ formatMonth(0) }} — {{ formatMonth(game.model.tick) }} · THE MANDATE IN RETROSPECT</span>
      <h3>{{ report.verdict }}</h3>
      <p>{{ report.opening }}</p>
    </div>

    <div class="report-voices">
      <blockquote v-for="voice in report.voices" :key="voice.who">
        <span class="eyebrow">{{ voice.who }}</span>
        <p>{{ voice.text }}</p>
        <cite>{{ voice.metric }}</cite>
      </blockquote>
    </div>

    <h3>The record you leave</h3>
    <div class="report-changes">
      <div v-for="change in report.changes" :key="change.label">
        <span>{{ change.label }}</span>
        <strong>{{ formatChange(change.before, change.unit) }} <span>→</span> {{ formatChange(change.after, change.unit) }}</strong>
      </div>
    </div>

    <template v-if="report.chains.length">
      <h3>The long threads</h3>
      <details v-for="chain in report.chains" :key="chain.title" class="report-chain">
        <summary>{{ chain.title }}</summary>
        <ol class="causal-chain">
          <li v-for="cause in chain.causes.slice(-3)" :key="cause.id">
            <div class="cause-meta">{{ formatMonth(cause.tick) }} <span>· {{ cause.rule === 'government' ? 'Your decision' : cause.rule }}</span></div>
            <h3>{{ cause.title }}</h3><p>{{ cause.detail }}</p>
          </li>
        </ol>
      </details>
    </template>

    <h3>What made the papers</h3>
    <template v-if="report.moments.length">
      <div v-for="article in report.moments" :key="article.id" class="report-moment">
        <span class="eyebrow">{{ formatMonth(article.tick) }} · {{ article.category }}</span>
        <h4>{{ article.headline }}</h4><p>{{ article.body }}</p>
      </div>
    </template>
    <p v-else>The mandate passed without a major dispatch. The quieter changes live in the national accounts.</p>

    <p class="small muted">{{ report.closing }}</p>
    <div class="modal-actions">
      <button id="download-report" class="outline" @click="exportReport">Export the mandate ↓</button>
      <button id="next-country" class="primary" @click="emit('newCountry')">A new country →</button>
    </div>
  </BaseModal>
</template>
