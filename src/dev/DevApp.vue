<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { MUTABLE_FIELDS, type Effect, type Metric, type MutableField } from '../sim/types';
import { traceStep, type PhaseTrace } from '../sim/trace';
import { createGame } from '../sim/world';
import RuleLens from './RuleLens.vue';
import './devtools.css';

const SUMMARY_METRICS: { key: Metric; label: string; percent?: boolean }[] = [
  { key: 'approval', label: 'Approval', percent: true },
  { key: 'happiness', label: 'Happiness', percent: true },
  { key: 'foodSecurity', label: 'Food security', percent: true },
  { key: 'employment', label: 'Employment', percent: true },
  { key: 'crime', label: 'Crime', percent: true },
  { key: 'pollution', label: 'Pollution', percent: true },
  { key: 'wealth', label: 'Wealth' },
  { key: 'output', label: 'Output' },
];

const PERCENT_FIELDS = new Set<MutableField>([
  'children',
  'seniors',
  'education',
  'health',
  'happiness',
  'approval',
  'crime',
  'pollution',
  'infrastructure',
  'employment',
  'foodSecurity',
  'sportsInterest',
  'agriculture',
  'manufacturing',
  'services',
  'sports',
  'businessHealth',
]);

const seed = ref('dev-lab');
const width = ref(18);
const height = ref(14);
const mandate = ref(48);
const game = shallowRef(createGame(seed.value, width.value, height.value, mandate.value));
const selectedPhaseIndex = ref(0);
const inspectedRuleId = ref('');
const selectedRuleId = ref('all');
const selectedEffectIndex = ref(0);
const effectFilter = ref('');
const selectedCellId = ref(firstLandCellId());
const navigationNote = ref('');

const trace = computed(() => traceStep(game.value));
const currentPhase = computed(() => trace.value.phases[selectedPhaseIndex.value]);
const activeRuleId = computed(() => {
  const phase = currentPhase.value;
  if (!phase) return '';
  return phase.rules.some(rule => rule.id === inspectedRuleId.value)
    ? inspectedRuleId.value
    : phase.rules[0]?.id ?? '';
});
const activeRule = computed(() => (
  currentPhase.value?.rules.find(rule => rule.id === activeRuleId.value)
));
const landCells = computed(() => game.value.model.cells.filter(cell => cell.biome !== 'water'));

function firstLandCellId(): number {
  return game.value?.model.cells.find(cell => cell.biome !== 'water')?.id
    ?? createGame('dev-lab', 18, 14, 48).model.cells.find(cell => cell.biome !== 'water')!.id;
}

function effectTarget(effect: Effect): string {
  switch (effect.kind) {
    case 'delta':
      return `cell ${effect.cell} · ${effect.field}`;
    case 'transfer':
      return `${effect.from} → ${effect.to} · ${effect.resource}`;
    case 'trade':
      return `${effect.from} → ${effect.to} · ${effect.resource}`;
    case 'budget':
      return 'public budget';
    case 'event':
      return `event · ${effect.key}`;
  }
}

function effectAmount(effect: Effect): string {
  switch (effect.kind) {
    case 'delta':
    case 'transfer':
      return signed(effect.amount);
    case 'trade':
      return `${effect.amount.toFixed(3)} @ ${effect.price.toFixed(2)}`;
    case 'budget':
      return `debt ${signed(effect.debtDelta)}`;
    case 'event':
      return 'trigger';
  }
}

function effectEvidence(effect: Effect): string {
  return 'evidence' in effect && effect.evidence ? effect.evidence.title : '';
}

const allEffects = computed(() => {
  const phase = currentPhase.value;
  if (!phase) return [];

  return phase.rules.flatMap(rule => {
    if (selectedRuleId.value !== 'all' && selectedRuleId.value !== rule.id) return [];
    return rule.effects.map((effect, index) => ({
      id: `${rule.id}:${index}`,
      rule: rule.id,
      effect,
      target: effectTarget(effect),
    }));
  });
});

const filteredEffects = computed(() => {
  const query = effectFilter.value.trim().toLowerCase();
  if (!query) return allEffects.value;

  return allEffects.value.filter(row => {
    return `${row.rule} ${row.effect.kind} ${row.target} ${effectEvidence(row.effect)}`
      .toLowerCase()
      .includes(query);
  });
});

const visibleEffects = computed(() => filteredEffects.value.slice(0, 300));
const selectedEffect = computed(() => visibleEffects.value[selectedEffectIndex.value]);

watch(currentPhase, phase => {
  if (!phase?.rules.some(rule => rule.id === inspectedRuleId.value)) {
    inspectedRuleId.value = phase?.rules[0]?.id ?? '';
  }
  selectedRuleId.value = 'all';
  selectedEffectIndex.value = 0;
  effectFilter.value = '';
  if (phase && !phase.rules.length) selectedRuleId.value = '';
});

watch(filteredEffects, () => {
  selectedEffectIndex.value = 0;
});

function changedCellCount(phase: PhaseTrace): number {
  let changed = 0;
  for (let index = 0; index < phase.before.cells.length; index += 1) {
    const before = phase.before.cells[index];
    const after = phase.after.cells[index];
    if (MUTABLE_FIELDS.some(field => Math.abs(before[field] - after[field]) > 1e-10)) {
      changed += 1;
    }
  }
  return changed;
}

function phaseEffectCount(phase: PhaseTrace): number {
  return phase.rules.reduce((sum, rule) => sum + rule.effects.length, 0);
}

function inspectRule(ruleId: string): void {
  inspectedRuleId.value = ruleId;
  navigationNote.value = '';
}

function inspectAndFilterRule(ruleId: string): void {
  inspectedRuleId.value = ruleId;
  selectedRuleId.value = ruleId;
  navigationNote.value = '';
}

function navigateToRule(target: {
  ruleId: string;
  phase: string;
  monthDelta: number;
  via: string;
}): void {
  const phaseIndex = trace.value.phases.findIndex(phase => phase.phase === target.phase);
  if (phaseIndex < 0) {
    navigationNote.value = `Could not find phase ${target.phase} in the current month.`;
    return;
  }

  selectedPhaseIndex.value = phaseIndex;
  inspectedRuleId.value = target.ruleId;
  selectedRuleId.value = 'all';
  navigationNote.value = target.monthDelta === 0
    ? `Followed ${target.via} → ${target.ruleId}.`
    : `Followed ${target.via} → ${target.ruleId}; showing its current-month value.`;
}

const cellChanges = computed(() => {
  const phase = currentPhase.value;
  if (!phase) return [];

  const before = phase.before.cells[selectedCellId.value];
  const after = phase.after.cells[selectedCellId.value];
  if (!before || !after) return [];

  return MUTABLE_FIELDS.flatMap(field => {
    const delta = after[field] - before[field];
    if (Math.abs(delta) <= 1e-10) return [];
    return [{ field, before: before[field], after: after[field], delta }];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
});

function reset(): void {
  game.value = createGame(seed.value.trim(), width.value, height.value, mandate.value);
  selectedPhaseIndex.value = 0;
  navigationNote.value = '';
  selectedCellId.value = firstLandCellId();
}

function commitMonth(): void {
  if (game.value.ended) return;
  game.value = trace.value.result;
  selectedPhaseIndex.value = 0;
  navigationNote.value = '';
  if (game.value.model.cells[selectedCellId.value]?.biome === 'water') {
    selectedCellId.value = firstLandCellId();
  }
}

function setPhase(index: number): void {
  selectedPhaseIndex.value = index;
  navigationNote.value = '';
}

function previousPhase(): void {
  selectedPhaseIndex.value = Math.max(0, selectedPhaseIndex.value - 1);
  navigationNote.value = '';
}

function nextPhase(): void {
  selectedPhaseIndex.value = Math.min(trace.value.phases.length - 1, selectedPhaseIndex.value + 1);
  navigationNote.value = '';
}

function signed(value: number): string {
  if (Math.abs(value) < 1e-12) return '0';
  return `${value > 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 0.01 ? 5 : 3)}`;
}

function formatMetric(value: number, percent = false): string {
  if (percent) return `${(value * 100).toFixed(2)}%`;
  if (Math.abs(value) >= 10_000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return value.toFixed(2);
}

function formatField(field: MutableField, value: number): string {
  if (PERCENT_FIELDS.has(field)) return `${(value * 100).toFixed(2)}%`;
  if (Math.abs(value) >= 10_000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toFixed(3);
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
</script>

<template>
  <div class="dev-shell">
    <header class="dev-header">
      <div>
        <span class="dev-kicker">COMMONWEALTH / SIMULATION WORKBENCH</span>
        <h1>See the engine think.</h1>
        <p>Follow each rule from the data it reads, through its local sensitivities and effects, into the later phases it changes.</p>
      </div>
      <a class="dev-player-link" href="/">← Player UI</a>
    </header>

    <section class="dev-controls" aria-label="Simulation setup">
      <label>
        Seed
        <input v-model="seed" aria-label="Developer seed" />
      </label>
      <label>
        Width
        <input v-model.number="width" aria-label="Developer world width" type="number" min="12" max="80" />
      </label>
      <label>
        Height
        <input v-model.number="height" aria-label="Developer world height" type="number" min="12" max="80" />
      </label>
      <label>
        Mandate
        <input v-model.number="mandate" aria-label="Developer mandate" type="number" min="1" max="240" />
      </label>
      <button class="dev-button" @click="reset">Reset world</button>
      <button class="dev-button primary" :disabled="game.ended" @click="commitMonth">
        Commit month {{ game.model.tick + 1 }}
      </button>
      <div class="dev-state-badge">
        <strong>tick {{ game.model.tick }}</strong>
        <span>{{ game.model.width }}×{{ game.model.height }} · {{ game.model.cells.length }} cells</span>
      </div>
    </section>

    <main class="dev-layout">
      <aside class="dev-phases">
        <div class="dev-panel-heading">
          <span>Execution</span>
          <strong>Month {{ game.model.tick + 1 }}</strong>
        </div>
        <button
          v-for="(phase, index) in trace.phases"
          :key="phase.phase"
          class="phase-button"
          :class="{ active: index === selectedPhaseIndex }"
          @click="setPhase(index)"
        >
          <span class="phase-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="phase-copy">
            <strong>{{ phase.phase }}</strong>
            <small>{{ phase.rules.length }} {{ phase.rules.length === 1 ? 'rule' : 'rules' }} · {{ phaseEffectCount(phase) }} effects · {{ changedCellCount(phase) }} cells</small>
          </span>
        </button>
      </aside>

      <section v-if="currentPhase" class="dev-main-panel">
        <div class="phase-title-row">
          <div>
            <span class="dev-kicker">MONTH {{ game.model.tick + 1 }} · PHASE {{ selectedPhaseIndex + 1 }} / {{ trace.phases.length }}</span>
            <h2>{{ currentPhase.phase }}</h2>
            <p>All rules below read the same immutable snapshot. Their effects settle together before the next phase can read the result.</p>
            <p v-if="navigationNote" class="dev-note">{{ navigationNote }}</p>
          </div>
          <div class="phase-nav">
            <button class="dev-icon-button" :disabled="selectedPhaseIndex === 0" @click="previousPhase">←</button>
            <button class="dev-icon-button" :disabled="selectedPhaseIndex === trace.phases.length - 1" @click="nextPhase">→</button>
          </div>
        </div>

        <section class="dev-section" aria-label="Rules in this phase">
          <div class="dev-section-heading">
            <div>
              <span class="dev-kicker">RULES IN THIS PHASE</span>
              <h3>{{ currentPhase.rules.length }} {{ currentPhase.rules.length === 1 ? 'rule' : 'rules' }}</h3>
            </div>
            <p class="dev-note">Choose which rule becomes the central node in the causal graph.</p>
          </div>

          <div class="rule-tabs" role="tablist" aria-label="Rule to inspect">
            <button
              v-for="rule in currentPhase.rules"
              :key="rule.id"
              :class="{ active: activeRuleId === rule.id }"
              @click="inspectRule(rule.id)"
            >
              {{ rule.id }} <span>{{ rule.effects.length }} effects</span>
            </button>
          </div>

          <div v-if="activeRule" class="rule-descriptions">
            <article>
              <code>{{ activeRule.id }}</code>
              <p>{{ activeRule.description }}</p>
            </article>
          </div>
        </section>

        <RuleLens
          v-if="activeRuleId"
          :game="game"
          :phase="currentPhase"
          :rule-id="activeRuleId"
          @navigate-rule="navigateToRule"
        />

        <div class="dev-summary-grid">
          <article v-for="metric in SUMMARY_METRICS" :key="metric.key" class="summary-card">
            <span>{{ metric.label }}</span>
            <strong>{{ formatMetric(currentPhase.afterSummary[metric.key], metric.percent) }}</strong>
            <small :class="{ positive: currentPhase.afterSummary[metric.key] - currentPhase.beforeSummary[metric.key] > 0, negative: currentPhase.afterSummary[metric.key] - currentPhase.beforeSummary[metric.key] < 0 }">
              {{ signed(currentPhase.afterSummary[metric.key] - currentPhase.beforeSummary[metric.key]) }}
            </small>
          </article>
        </div>

        <section class="dev-section">
          <div class="dev-section-heading">
            <div>
              <span class="dev-kicker">RAW RULES</span>
              <h3>Forensic view</h3>
            </div>
            <div class="phase-side-stats">
              <span>{{ currentPhase.causesAdded }} causes</span>
              <span>{{ currentPhase.articlesAdded }} articles</span>
            </div>
          </div>

          <div class="rule-tabs" role="tablist" aria-label="Rule filter">
            <button :class="{ active: selectedRuleId === 'all' }" @click="selectedRuleId = 'all'">All rules</button>
            <button
              v-for="rule in currentPhase.rules"
              :key="rule.id"
              :class="{ active: selectedRuleId === rule.id }"
              @click="inspectAndFilterRule(rule.id)"
            >
              {{ rule.id }} <span>{{ rule.effects.length }}</span>
            </button>
          </div>

          <div class="rule-descriptions">
            <article v-for="rule in currentPhase.rules" :key="rule.id">
              <code>{{ rule.id }}</code>
              <p>{{ rule.description }}</p>
            </article>
          </div>
        </section>

        <section class="dev-section effect-section">
          <div class="dev-section-heading">
            <div>
              <span class="dev-kicker">RAW PROPOSALS</span>
              <h3>{{ filteredEffects.length }} effects before settlement</h3>
            </div>
            <input v-model="effectFilter" class="effect-filter" aria-label="Filter effects" placeholder="Filter rule, kind, cell, field…" />
          </div>

          <div class="effect-workspace">
            <div class="effect-list" role="listbox" aria-label="Simulation effects">
              <button
                v-for="(row, index) in visibleEffects"
                :key="row.id"
                class="effect-row"
                :class="{ active: index === selectedEffectIndex }"
                @click="selectedEffectIndex = index"
              >
                <code>{{ row.effect.kind }}</code>
                <span class="effect-target">{{ row.target }}</span>
                <span class="effect-amount">{{ effectAmount(row.effect) }}</span>
                <small>{{ row.rule }}</small>
              </button>
              <p v-if="filteredEffects.length > visibleEffects.length" class="dev-note">
                Showing the first {{ visibleEffects.length }} effects. Filter the list to inspect the rest.
              </p>
              <p v-if="!visibleEffects.length" class="dev-note">No effects match this filter.</p>
            </div>

            <div class="effect-detail">
              <template v-if="selectedEffect">
                <span class="dev-kicker">RAW EFFECT</span>
                <h4>{{ selectedEffect.rule }}</h4>
                <p v-if="effectEvidence(selectedEffect.effect)" class="effect-evidence">{{ effectEvidence(selectedEffect.effect) }}</p>
                <pre>{{ json(selectedEffect.effect) }}</pre>
              </template>
              <p v-else class="dev-note">Select an effect to inspect its exact payload.</p>
            </div>
          </div>
        </section>
      </section>

      <aside v-if="currentPhase" class="dev-cell-panel">
        <div class="dev-panel-heading">
          <span>Cell inspector</span>
          <strong>{{ currentPhase.after.cells[selectedCellId]?.name }}</strong>
        </div>
        <label class="cell-select-label">
          Mapxel
          <select v-model.number="selectedCellId" aria-label="Inspect mapxel">
            <option v-for="cell in landCells" :key="cell.id" :value="cell.id">
              #{{ cell.id }} · {{ cell.name }}
            </option>
          </select>
        </label>

        <div class="cell-meta" v-if="currentPhase.after.cells[selectedCellId]">
          <span>Region {{ currentPhase.after.cells[selectedCellId].region }}</span>
          <span>{{ currentPhase.after.cells[selectedCellId].biome }}</span>
          <span>({{ currentPhase.after.cells[selectedCellId].x }}, {{ currentPhase.after.cells[selectedCellId].y }})</span>
        </div>

        <div class="cell-changes">
          <div class="cell-change-header">
            <span>Changed field</span><span>before</span><span>after</span><span>Δ</span>
          </div>
          <div v-for="change in cellChanges" :key="change.field" class="cell-change-row">
            <code>{{ change.field }}</code>
            <span>{{ formatField(change.field, change.before) }}</span>
            <span>{{ formatField(change.field, change.after) }}</span>
            <strong :class="{ positive: change.delta > 0, negative: change.delta < 0 }">{{ signed(change.delta) }}</strong>
          </div>
          <p v-if="!cellChanges.length" class="dev-note">This phase did not change the selected mapxel.</p>
        </div>

        <section class="account-box">
          <span class="dev-kicker">PUBLIC ACCOUNTS</span>
          <dl>
            <div><dt>Treasury</dt><dd>{{ currentPhase.after.treasury.toFixed(2) }}</dd></div>
            <div><dt>Debt</dt><dd>{{ currentPhase.after.debt.toFixed(2) }}</dd></div>
            <div><dt>Revenue</dt><dd>{{ currentPhase.after.budget.revenue.toFixed(2) }}</dd></div>
            <div><dt>Spending</dt><dd>{{ currentPhase.after.budget.spending.toFixed(2) }}</dd></div>
            <div><dt>Funding</dt><dd>{{ (currentPhase.after.budget.funding * 100).toFixed(1) }}%</dd></div>
          </dl>
        </section>
      </aside>
    </main>

    <footer class="dev-footer">
      <span>Access this workbench with <code>?dev=1</code>.</span>
      <span>Sensitivity is local to this exact seed, tick, rule inputs, and random stream.</span>
    </footer>
  </div>
</template>