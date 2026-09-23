<script setup lang="ts">
import { computed } from 'vue';
import { traceCauses } from '../../sim/narrative';
import type { Game } from '../../sim/types';
import { formatMonth } from '../../ui/format';
import BaseModal from './BaseModal.vue';

const props = defineProps<{ game: Game; ids: string[] }>();
defineEmits<{ close: [] }>();

const chain = computed(() => traceCauses(props.game, props.ids, 60));
</script>

<template>
  <BaseModal title="Follow the consequences" wide @close="$emit('close')">
    <p>Recorded contributing factors, ordered from earlier causes to later effects. This trace is selective: it shows significant recorded changes, and does not prove that any one factor alone caused an outcome.</p>
    <ol v-if="chain.length" class="causal-chain">
      <li v-for="cause in chain" :key="cause.id">
        <div class="cause-meta">{{ formatMonth(cause.tick) }} <span>· {{ cause.rule === 'government' ? 'Your decision' : cause.rule }}</span></div>
        <h3>{{ cause.title }}</h3>
        <p>{{ cause.detail }}</p>
        <details v-if="cause.observations.length">
          <summary>Observed inputs ({{ cause.observations.length }})</summary>
          <dl>
            <div v-for="observation in cause.observations.slice(0, 12)" :key="`${observation.label}-${observation.cell}`">
              <dt>{{ observation.label }}<template v-if="observation.cell !== undefined"> · #{{ observation.cell }}</template></dt>
              <dd>{{ observation.value.toFixed(3) }}</dd>
            </div>
          </dl>
        </details>
        <small class="muted">Record {{ cause.id }}{{ cause.parents.length ? ` · linked to ${cause.parents.join(', ')}` : ' · no earlier recorded contributor' }}</small>
      </li>
    </ol>
    <p v-else>No contributing changes have been recorded yet.</p>
  </BaseModal>
</template>
