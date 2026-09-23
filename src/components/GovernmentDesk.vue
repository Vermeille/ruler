<script setup lang="ts">
import { ref } from 'vue';
import type { Game } from '../sim/types';
import type { DeskTab, PolicyTab } from '../ui/view-types';
import CabinetPanel from './CabinetPanel.vue';
import LedgerPanel from './LedgerPanel.vue';
import TrendsPanel from './TrendsPanel.vue';
import RulesPanel from './RulesPanel.vue';

defineProps<{
  game: Game;
  selected: Set<number>;
}>();

const emit = defineEmits<{
  preview: [input: unknown];
  error: [message: string];
  pauseEditing: [];
  causes: [ids: string[]];
  locate: [cell: number];
  exportData: [];
}>();

const tab = ref<DeskTab>('cabinet');
const policyTab = ref<PolicyTab>('budget');
const feedFilter = ref('all');
const tabs: readonly [DeskTab, string][] = [
  ['cabinet', 'The cabinet'],
  ['ledger', 'The daily ledger'],
  ['trends', 'National accounts'],
  ['rules', 'How the country works'],
];
</script>

<template>
  <section class="panel desk">
    <div class="desk-tabs" role="tablist" aria-label="Government desk">
      <button
        v-for="[id, name] in tabs"
        :key="id"
        role="tab"
        :aria-selected="tab === id"
        :class="{ active: tab === id }"
        @click="tab = id"
      >
        {{ name }}<span v-if="id === 'ledger'" class="count">{{ game.articles.length }}</span>
      </button>
      <span class="desk-note">{{ tab === 'cabinet' ? 'Small decisions. Long consequences.' : 'Every number has a neighborhood.' }}</span>
    </div>

    <div class="desk-content" role="tabpanel">
      <CabinetPanel
        v-if="tab === 'cabinet'"
        :game="game"
        :selected="selected"
        :policy-tab="policyTab"
        @update:policy-tab="policyTab = $event"
        @preview="emit('preview', $event)"
        @error="emit('error', $event)"
        @pause-editing="emit('pauseEditing')"
      />
      <LedgerPanel
        v-else-if="tab === 'ledger'"
        :game="game"
        :feed-filter="feedFilter"
        @update:feed-filter="feedFilter = $event"
        @causes="emit('causes', $event)"
        @locate="emit('locate', $event)"
      />
      <TrendsPanel v-else-if="tab === 'trends'" :game="game" @export-data="emit('exportData')" />
      <RulesPanel v-else />
    </div>
  </section>
</template>
