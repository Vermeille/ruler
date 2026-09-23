<script setup lang="ts">
import { defaultRules } from '../sim/rules';
import { label } from '../ui/format';
</script>

<template>
  <div class="section-intro">
    <div><span class="eyebrow">THE COUNTRY BENEATH THE STORIES</span><h2>Simple rules. Interconnected lives.</h2><p>Each month follows this sequence. Local conditions shape what happens next.</p></div>
  </div>
  <div class="rule-grid">
    <div v-for="(rule, index) in defaultRules" :key="rule.id" class="rule-card">
      <span class="rule-number">{{ String(index + 1).padStart(2, '0') }}</span>
      <div><h3>{{ label(rule.phase) }}</h3><p>{{ rule.description }}</p></div>
    </div>
  </div>
  <p class="small muted">Money moves between private, treasury, and external accounts. Food is produced, eaten, traded, or spoiled. Events use seeded probabilities. Indices move gradually toward conditions implied by the rules.</p>
</template>
