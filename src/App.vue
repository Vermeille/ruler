<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import GovernmentDesk from './components/GovernmentDesk.vue';
import InspectorPanel from './components/InspectorPanel.vue';
import MapPanel from './components/MapPanel.vue';
import MetricsStrip from './components/MetricsStrip.vue';
import SimulationControls from './components/SimulationControls.vue';
import CauseDialog from './components/dialogs/CauseDialog.vue';
import HelpDialog from './components/dialogs/HelpDialog.vue';
import NewCountryDialog from './components/dialogs/NewCountryDialog.vue';
import PolicyPreviewDialog from './components/dialogs/PolicyPreviewDialog.vue';
import ReportDialog from './components/dialogs/ReportDialog.vue';
import SaveDialog from './components/dialogs/SaveDialog.vue';
import { useGame } from './composables/useGame';
import { enact, previewActions } from './sim/policy';
import type { Action, Game } from './sim/types';
import { download } from './ui/download';
import { formatPercent } from './ui/format';
import type { PolicyPreviewData } from './ui/view-types';

type ModalState =
  | { kind: 'help' }
  | { kind: 'save' }
  | { kind: 'new' }
  | { kind: 'report' }
  | { kind: 'causes'; ids: string[] }
  | { kind: 'preview'; preview: PolicyPreviewData }
  | null;

const toastMessage = ref('');
const toastIsError = ref(false);
// Modal payloads can contain simulation Actions. Keep them raw so the
// simulation's structuredClone-based validation never receives Vue proxies.
const modal = shallowRef<ModalState>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string, error = false): void {
  toastMessage.value = message;
  toastIsError.value = error;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toastMessage.value === message) toastMessage.value = '';
  }, 6000);
}

const {
  game,
  selected,
  layers,
  zoom,
  roads,
  running,
  speed,
  saveFailed,
  darkMode,
  ready,
  applyTheme,
  setSelection,
  clearSelection,
  save,
  pause,
  advance,
  toggleRunning,
  setSpeed,
  replaceGame,
  newGame,
  initialize,
} = useGame({ error: message => toast(message, true) });

function openModal(next: NonNullable<ModalState>): void {
  pause();
  modal.value = next;
}

function closeModal(): void {
  modal.value = null;
}

function advanceOneMonth(): void {
  pause();
  advance();
}

function preview(input: unknown): void {
  try {
    openModal({ kind: 'preview', preview: previewActions(game.value, input) });
  } catch (error) {
    toast((error as Error).message, true);
  }
}

function enactPreview(actions: Action[]): void {
  try {
    game.value = enact(game.value, actions);
    void save();
    closeModal();
    toast('Policy enacted. Advance a month to see the first effects.');
  } catch (error) {
    toast((error as Error).message, true);
  }
}

function restoreGame(next: Game): void {
  replaceGame(next);
  closeModal();
  toast('Your country is restored.');
}

function createCountry(seed: string): void {
  try {
    newGame(seed);
    closeModal();
    toast('Welcome to your new mandate.');
  } catch (error) {
    toast((error as Error).message, true);
  }
}

async function locate(cell: number): Promise<void> {
  setSelection([cell]);
  await nextTick();
  document.querySelector('.workspace')?.scrollIntoView({ behavior: 'smooth' });
}

function exportAccounts(): void {
  const keys = Object.keys(game.value.initial) as (keyof Game['initial'])[];
  const rows = game.value.history.map(entry =>
    [entry.tick, ...keys.map(key => entry.summary[key])].join(','),
  );
  download(
    'commonwealth-accounts.csv',
    ['month,' + keys.join(','), ...rows].join('\n'),
    'text/csv',
  );
}

function handleKeydown(event: KeyboardEvent): void {
  const interactive = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement
    || event.target instanceof HTMLButtonElement;

  if (event.code !== 'Space' || interactive || modal.value) return;
  event.preventDefault();
  toggleRunning();
}

function handleVisibility(): void {
  if (document.hidden && running.value) pause();
}

// Run synchronously with the Game assignment. During autosave restoration
// `ready` is still false, so an already-finished save does not reopen the
// report. Live transitions to an ended mandate still open it immediately.
watch(game, (next, previous) => {
  if (ready.value && next.ended && !previous?.ended) {
    openModal({ kind: 'report' });
  }
}, { flush: 'sync' });

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  document.addEventListener('visibilitychange', handleVisibility);
  void initialize();
});

onBeforeUnmount(() => {
  clearTimeout(toastTimer);
  window.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('visibilitychange', handleVisibility);
});
</script>

<template>
  <main v-if="!ready"><h1>Opening the Commonwealth…</h1></main>

  <template v-else>
    <AppHeader
      :game="game"
      :dark-mode="darkMode"
      @toggle-theme="applyTheme(!darkMode)"
      @help="openModal({ kind: 'help' })"
      @save="openModal({ kind: 'save' })"
      @new-country="openModal({ kind: 'new' })"
    />

    <main>
      <SimulationControls
        :game="game"
        :running="running"
        :speed="speed"
        @advance="advanceOneMonth"
        @toggle="toggleRunning"
        @speed="setSpeed"
      />

      <MetricsStrip :game="game" />

      <div v-if="game.ended" class="end-banner">
        <span>Your mandate is over. The country has a story to tell.</span>
        <button id="report" class="primary" @click="openModal({ kind: 'report' })">Read your legacy →</button>
      </div>
      <div v-else-if="game.model.budget.funding < 0.99" class="alert-banner">
        Public services received {{ formatPercent(game.model.budget.funding) }} of promised funding this month. Review your budget.
      </div>

      <section class="workspace">
        <MapPanel
          :game="game"
          :selected="selected"
          :layers="layers"
          :zoom="zoom"
          :roads="roads"
          :running="running"
          :dark-mode="darkMode"
          @select="setSelection"
          @update:layers="layers = $event"
          @update:zoom="zoom = $event"
          @update:roads="roads = $event"
        />
        <InspectorPanel
          :game="game"
          :selected="selected"
          @clear="clearSelection"
          @causes="openModal({ kind: 'causes', ids: $event })"
        />
      </section>

      <GovernmentDesk
        :game="game"
        :selected="selected"
        @preview="preview"
        @error="toast($event, true)"
        @pause-editing="pause"
        @causes="openModal({ kind: 'causes', ids: $event })"
        @locate="locate"
        @export-data="exportAccounts"
      />

      <footer>
        <span>
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 5v22M7 27h18M16 19C3 19 4 8 4 8s10 0 12 11Zm0-6C16 4 25 4 25 4s2 9-9 9Zm0 11c0-9 12-11 12-11s0 11-12 11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
          COMMONWEALTH <span class="subtle">/</span> A political simulation
        </span>
        <span>Seed: {{ game.model.seed }} <span class="subtle">·</span> {{ saveFailed ? 'Export to save progress' : 'Progress saves automatically' }} <span class="save-dot" /></span>
      </footer>
    </main>

    <HelpDialog v-if="modal?.kind === 'help'" @close="closeModal" />
    <SaveDialog v-else-if="modal?.kind === 'save'" :game="game" @close="closeModal" @restore="restoreGame" />
    <NewCountryDialog v-else-if="modal?.kind === 'new'" :game="game" @close="closeModal" @create="createCountry" />
    <CauseDialog v-else-if="modal?.kind === 'causes'" :game="game" :ids="modal.ids" @close="closeModal" />
    <PolicyPreviewDialog v-else-if="modal?.kind === 'preview'" :preview="modal.preview" @close="closeModal" @enact="enactPreview" />
    <ReportDialog v-else-if="modal?.kind === 'report'" :game="game" @close="closeModal" @new-country="openModal({ kind: 'new' })" />

    <div v-if="toastMessage" id="toast" role="status" class="toast" :class="{ error: toastIsError }">{{ toastMessage }}</div>
  </template>
</template>
