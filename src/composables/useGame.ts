import { onBeforeUnmount, ref, shallowRef } from 'vue';
import { createGame } from '../sim/world';
import { step } from '../sim/engine';
import { deserialize, serialize } from '../sim/save';
import type { Game } from '../sim/types';
import { ALL_LAYERS, type Layer } from '../ui/map-layers';
import { loadAutosave, storeAutosave } from '../ui/storage';

export interface GameNotifications {
  error(message: string): void;
}

export function useGame(notifications: GameNotifications) {
  const game = shallowRef<Game>(createGame());
  const selected = ref<Set<number>>(new Set());
  const layers = ref<Layer[]>([...ALL_LAYERS]);
  const zoom = ref(1);
  const roads = ref(false);
  const running = ref(false);
  const speed = ref(1);
  const saveFailed = ref(false);
  const darkMode = ref(localStorage.getItem('commonwealth-theme') === 'dark');
  const ready = ref(false);

  let timer: ReturnType<typeof setTimeout> | undefined;

  function applyTheme(enabled: boolean): void {
    darkMode.value = enabled;
    document.body.classList.toggle('dark-mode', enabled);
    document.documentElement.style.colorScheme = enabled ? 'dark' : 'light';
    localStorage.setItem('commonwealth-theme', enabled ? 'dark' : 'light');
  }

  function setSelection(ids: number[], additive = false): void {
    const next = additive ? new Set(selected.value) : new Set<number>();
    for (const id of ids) {
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
    }
    selected.value = next;
  }

  function clearSelection(): void {
    selected.value = new Set();
  }

  async function save(): Promise<void> {
    try {
      await storeAutosave(serialize(game.value));
      saveFailed.value = false;
    } catch {
      if (!saveFailed.value) {
        notifications.error(
          'Autosave is unavailable. Export a save to keep this mandate.',
        );
      }
      saveFailed.value = true;
    }
  }

  function pause(): void {
    running.value = false;
    clearTimeout(timer);
  }

  function advance(): void {
    if (game.value.ended) return;

    try {
      game.value = step(game.value);
      void save();
    } catch (error) {
      pause();
      notifications.error(
        `The month was rolled back: ${(error as Error).message}`,
      );
    }
  }

  function schedule(): void {
    clearTimeout(timer);
    if (!running.value || game.value.ended) return;

    timer = setTimeout(() => {
      advance();
      schedule();
    }, 5000 / speed.value);
  }

  function toggleRunning(): void {
    if (game.value.ended) return;
    running.value = !running.value;
    schedule();
  }

  function setSpeed(value: number): void {
    speed.value = value;
    schedule();
  }

  function replaceGame(next: Game): void {
    pause();
    game.value = next;
    clearSelection();
    layers.value = [...ALL_LAYERS];
    zoom.value = 1;
    roads.value = false;
    void save();
  }

  function newGame(seed: string): void {
    replaceGame(createGame(seed));
  }

  async function restore(serialized: string): Promise<void> {
    replaceGame(deserialize(serialized));
  }

  async function initialize(): Promise<void> {
    applyTheme(darkMode.value);
    try {
      const saved = await loadAutosave();
      if (saved) game.value = deserialize(saved);
    } catch {
      notifications.error(
        'The autosave could not be loaded. A fresh country is ready; you can import a backup.',
      );
    } finally {
      ready.value = true;
    }
  }

  onBeforeUnmount(() => clearTimeout(timer));

  return {
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
    schedule,
    toggleRunning,
    setSpeed,
    replaceGame,
    newGame,
    restore,
    initialize,
  };
}
