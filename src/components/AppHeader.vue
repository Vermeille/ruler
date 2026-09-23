<script setup lang="ts">
import type { Game } from '../sim/types';
import { formatMonth } from '../ui/format';

defineProps<{
  game: Game;
  darkMode: boolean;
}>();

defineEmits<{
  toggleTheme: [];
  help: [];
  save: [];
  newCountry: [];
}>();
</script>

<template>
  <header class="masthead">
    <a class="brand" href="#" aria-label="Commonwealth home">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M16 5v22M7 27h18M16 19C3 19 4 8 4 8s10 0 12 11Zm0-6C16 4 25 4 25 4s2 9-9 9Zm0 11c0-9 12-11 12-11s0 11-12 11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
      </svg>
      <span>Commonwealth<small>A COUNTRY OF SMALL DECISIONS</small></span>
    </a>

    <div class="mandate-info">
      <span class="live-dot" />
      <span>
        {{ game.ended ? 'Mandate complete' : 'Your first mandate' }}
        <small>{{ formatMonth(0) }} — {{ formatMonth(game.model.mandate) }}</small>
      </span>
    </div>

    <div class="header-actions">
      <button
        id="theme-toggle"
        class="quiet"
        :aria-pressed="darkMode"
        :aria-label="`Switch to ${darkMode ? 'light' : 'dark'} mode`"
        @click="$emit('toggleTheme')"
      >
        {{ darkMode ? '☀ Light mode' : '☾ Dark mode' }}
      </button>
      <button id="help" class="quiet" @click="$emit('help')">Field guide</button>
      <button id="save-menu" class="quiet" @click="$emit('save')">Save & load</button>
      <button id="new-country" class="outline" @click="$emit('newCountry')">New country <span>↗</span></button>
    </div>
  </header>
</template>
