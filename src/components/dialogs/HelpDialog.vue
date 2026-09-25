<script setup lang="ts">
import BaseModal from './BaseModal.vue';
defineEmits<{ close: [] }>();
</script>

<template>
  <BaseModal title="Your field guide" @close="$emit('close')">
    <p class="lead">You have five years (60 months). There is no single winning budget.</p>
    <ol class="guide">
      <li><strong>Read the country.</strong> Select a mapxel, drag a region, or use the region menu. Change map layers to find unequal conditions. Shift-click adds or removes mapxels.</li>
      <li><strong>Make a decision.</strong> Adjust taxes, fund a service, subsidize an industry, invest locally, or change a law in the cabinet. Review the projected cost, then enact it.</li>
      <li><strong>Give it time.</strong> Advance one month or press play. Effects are gradual. Editing a policy pauses the clock.</li>
      <li><strong>Listen to the stories.</strong> Read the Ledger and follow recorded causes. A popular industry can draw workers away from something the country still needs.</li>
      <li><strong>Face the public memory.</strong> At the end of your mandate, read the account from different communities and export it.</li>
    </ol>
    <div class="field-note"><strong>A first experiment</strong><p>Try a sports subsidy in one region. Watch the industry and food maps over the next year. Can neighboring farms and transport links absorb the change?</p></div>
    <p class="small muted">₡ is the fictional crown. One turn is one month; each mapxel covers about 4 km². Crime, health, and similar measures are abstract indices. World seeds reproduce the same starting conditions and random draws. No AI or API key is needed.</p>
  </BaseModal>
</template>
