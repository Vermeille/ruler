<script setup lang="ts">
import type { Action } from '../../sim/types';
import { formatMoney } from '../../ui/format';
import BaseModal from './BaseModal.vue';

export interface PolicyPreviewData {
  actions: Action[];
  descriptions: string[];
  monthlyChange: number;
  upfront: number;
  warnings: string[];
}

defineProps<{ preview: PolicyPreviewData }>();
const emit = defineEmits<{ close: []; enact: [actions: Action[]] }>();
</script>

<template>
  <BaseModal title="A decision, before it becomes a story." @close="emit('close')">
    <p>These measures take effect immediately. Economic and social responses unfold as the months pass.</p>
    <ul class="preview-list"><li v-for="description in preview.descriptions" :key="description">{{ description }}</li></ul>
    <div class="preview-cost">
      <span>Estimated monthly balance change<strong :class="preview.monthlyChange < 0 ? 'negative' : 'positive'">{{ preview.monthlyChange >= 0 ? '+' : '' }}{{ formatMoney(preview.monthlyChange) }}</strong></span>
      <span>One-time treasury cost<strong>{{ formatMoney(preview.upfront) }}</strong></span>
    </div>
    <p v-for="warning in preview.warnings" :key="warning" class="warning-note">{{ warning }}</p>
    <p class="small muted">This is an estimate at current output and employment. Secondary effects can change the eventual cost.</p>
    <div class="modal-actions">
      <button class="outline" @click="emit('close')">Keep considering</button>
      <button class="primary" @click="emit('enact', preview.actions)">Enact {{ preview.actions.length > 1 ? 'measures' : 'measure' }} →</button>
    </div>
  </BaseModal>
</template>
