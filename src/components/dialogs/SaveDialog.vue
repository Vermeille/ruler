<script setup lang="ts">
import { ref } from 'vue';
import { deserialize, serialize } from '../../sim/save';
import type { Game } from '../../sim/types';
import { download } from '../../ui/download';
import BaseModal from './BaseModal.vue';

const props = defineProps<{ game: Game }>();
const emit = defineEmits<{ close: []; restore: [game: Game] }>();
const error = ref('');

function exportSave(): void {
  download(`commonwealth-month-${props.game.model.tick}.json`, serialize(props.game));
}

async function importSave(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    if (file.size > 40_000_000) throw new Error('Save files must be smaller than 40 MB.');
    emit('restore', deserialize(await file.text()));
  } catch (cause) {
    error.value = (cause as Error).message;
  }
}
</script>

<template>
  <BaseModal title="Keep your country close." @close="emit('close')">
    <p>Progress autosaves in this browser. Export a file to back up your mandate or continue on another device.</p>
    <div class="save-options">
      <button id="export-save" class="primary" @click="exportSave">Export save ↓</button>
      <label class="outline upload">Import a save<input id="import-save" type="file" accept="application/json,.json" @change="importSave" /></label>
    </div>
    <p class="small muted">Importing replaces the current country after the file has passed validation. Export first if you want to keep both.</p>
    <p id="import-error" role="alert">{{ error }}</p>
  </BaseModal>
</template>
