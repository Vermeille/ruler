<script setup lang="ts">
import { ref } from 'vue';
import { serialize } from '../../sim/save';
import type { Game } from '../../sim/types';
import { download } from '../../ui/download';
import BaseModal from './BaseModal.vue';

const props = defineProps<{ game: Game }>();
const emit = defineEmits<{ close: []; create: [seed: string] }>();
const seed = ref(`alder-${Math.floor(Math.random() * 10000)}`);

function backup(): void {
  download(`commonwealth-month-${props.game.model.tick}.json`, serialize(props.game));
}
</script>

<template>
  <BaseModal title="Another country. Another possibility." @close="emit('close')">
    <p>A different seed gives you a different landscape. The same seed lets you try a different path through the same starting conditions.</p>
    <form id="new-form" @submit.prevent="emit('create', seed)">
      <label>Country seed<input v-model="seed" name="seed" maxlength="100" required /></label>
      <p class="small muted">Starting a country replaces the current autosave. Export it first if you want to return.</p>
      <div class="modal-actions">
        <button id="backup-first" type="button" class="outline" @click="backup">Export current country</button>
        <button class="primary">Begin a new mandate →</button>
      </div>
    </form>
  </BaseModal>
</template>
