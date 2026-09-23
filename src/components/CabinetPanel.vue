<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { forecastBudget, parseCommand, subsidyFor } from '../sim/policy';
import { LAWS, SECTORS, SERVICES, type Game, type Scope, type Service } from '../sim/types';
import { formatMoney, formatPercent, label } from '../ui/format';
import type { PolicyTab } from '../ui/view-types';

const props = defineProps<{
  game: Game;
  selected: Set<number>;
  policyTab: PolicyTab;
}>();

const emit = defineEmits<{
  'update:policyTab': [tab: PolicyTab];
  preview: [input: unknown];
  error: [message: string];
  pauseEditing: [];
}>();

const policyTabs: readonly PolicyTab[] = ['budget', 'development', 'laws', 'console'];
const lawInfo = {
  cleanAir: ['Clean Air Act', 'Lower industrial pollution, with a small manufacturing output cost.'],
  freeMovement: ['Freedom of movement', 'Allow residents to move toward nearby work and better living conditions.'],
  publicAssembly: ['Freedom of assembly', 'Protect civic life and public morale. Repeal carries a lasting wellbeing and approval cost.'],
  foodPriceControls: ['Food price controls', 'Cap posted staple prices at ₡1. Scarcity may persist if farmers cannot respond to higher prices.'],
} as const;

const incomeTax = ref(props.game.model.policy.incomeTax * 100);
const businessTax = ref(props.game.model.policy.businessTax * 100);
const minimumWage = ref(props.game.model.policy.minimumWage);
const service = ref<Service>('health');
const serviceAmount = ref(props.game.model.policy.spending.health);
const subsidySector = ref<(typeof SECTORS)[number]>('agriculture');
const subsidyAmount = ref(0.5);
const subsidyScope = ref(props.selected.size ? 'selected' : 'national');
const investmentProject = ref<'transport' | 'hospital' | 'school' | 'stadium'>('transport');
const investmentAmount = ref(10_000);
const investmentScope = ref(props.selected.size ? 'selected' : 'national');
const command = ref('');

const forecast = computed(() => forecastBudget(props.game.model));
const policy = computed(() => props.game.model.policy);

watch(() => props.game, () => {
  incomeTax.value = props.game.model.policy.incomeTax * 100;
  businessTax.value = props.game.model.policy.businessTax * 100;
  minimumWage.value = props.game.model.policy.minimumWage;
  serviceAmount.value = props.game.model.policy.spending[service.value];
});

watch(service, value => {
  serviceAmount.value = props.game.model.policy.spending[value];
});

function scope(value: string): Scope {
  if (value === 'national') return { kind: 'national' };
  if (value === 'selected') {
    return { kind: 'cells', ids: [...props.selected].sort((a, b) => a - b) };
  }
  return { kind: 'region', id: Number(value) };
}

function submitTaxes(): void {
  emit('preview', [
    { type: 'tax', tax: 'incomeTax', rate: Number(incomeTax.value) / 100 },
    { type: 'tax', tax: 'businessTax', rate: Number(businessTax.value) / 100 },
  ]);
}

function submitSpending(): void {
  emit('preview', { type: 'spending', service: service.value, amount: Number(serviceAmount.value) });
}

function submitMinimumWage(): void {
  emit('preview', { type: 'minimumWage', amount: Number(minimumWage.value) });
}

function submitSubsidy(): void {
  emit('preview', {
    type: 'subsidy',
    sector: subsidySector.value,
    amount: Number(subsidyAmount.value),
    scope: scope(subsidyScope.value),
  });
}

function submitInvestment(): void {
  emit('preview', {
    type: 'invest',
    project: investmentProject.value,
    amount: Number(investmentAmount.value),
    scope: scope(investmentScope.value),
  });
}

function submitCommand(): void {
  try {
    emit('preview', parseCommand(command.value, [...props.selected]));
  } catch (error) {
    emit('error', (error as Error).message);
  }
}

function toggleLaw(law: (typeof LAWS)[number]): void {
  emit('preview', { type: 'law', law, enabled: !props.game.model.policy.laws[law] });
}

const budgetNarrative = computed(() => props.game.model.tick === 0
  ? 'Projections use current output. They will change as households and businesses respond.'
  : `Last month: ${formatMoney(props.game.model.budget.revenue)} collected, ${formatMoney(props.game.model.budget.spending)} spent. ${formatPercent(props.game.model.budget.funding)} of services funded.`);
</script>

<template>
  <div class="cabinet-layout">
    <div class="cabinet-main" @focusin="emit('pauseEditing')">
      <div class="section-intro">
        <div><span class="eyebrow">THE TOOLS OF GOVERNMENT</span><h2>What will you set in motion?</h2></div>
        <div class="segmented">
          <button
            v-for="id in policyTabs"
            :key="id"
            :class="{ active: policyTab === id }"
            @click="emit('update:policyTab', id)"
          >
            {{ label(id) }}
          </button>
        </div>
      </div>

      <div v-if="policyTab === 'budget'" class="policy-grid">
        <form id="tax-form" class="policy-card" @submit.prevent="submitTaxes">
          <span class="card-icon">%</span><h3>Raise the revenue</h3><p>Taxes fund public life and reduce private reserves.</p>
          <label>Income tax <output id="income-value">{{ Math.round(incomeTax) }}%</output><input id="income-tax" v-model.number="incomeTax" name="income" type="range" min="0" max="65" /></label>
          <label>Business tax <output id="business-value">{{ Math.round(businessTax) }}%</output><input id="business-tax" v-model.number="businessTax" name="business" type="range" min="0" max="65" /></label>
          <button class="outline" :disabled="game.ended">Review tax changes →</button>
        </form>

        <form id="spending-form" class="policy-card" @submit.prevent="submitSpending">
          <span class="card-icon">↗</span><h3>Fund the everyday</h3><p>Health, schools, safe streets. Promises need a budget.</p>
          <label>Public service<select id="service-select" v-model="service" name="service"><option v-for="item in SERVICES" :key="item" :value="item">{{ label(item) }}</option></select></label>
          <label>₡ per resident / month<input id="service-amount" v-model.number="serviceAmount" name="amount" type="number" min="0" max="2" step="0.01" required /></label>
          <button class="outline" :disabled="game.ended">Review spending →</button>
        </form>
        <form id="wage-form" class="policy-card" @submit.prevent="submitMinimumWage">
          <span class="card-icon">₡</span><h3>Set a wage floor</h3><p>Firms compare the required pay with local production receipts after tax and imported inputs. A high floor can cut hiring.</p>
          <label>₡ per worker / month<input v-model.number="minimumWage" name="amount" type="number" min="0" max="10" step="0.1" required /></label>
          <button class="outline" :disabled="game.ended">Review wage floor →</button>
          <small>Zero removes the floor. Employment responds over time.</small>
        </form>
      </div>

      <div v-else-if="policyTab === 'development'" class="policy-grid">
        <form id="subsidy-form" class="policy-card" @submit.prevent="submitSubsidy">
          <span class="card-icon">♧</span><h3>Give an industry a nudge</h3><p>Recurring grants attract workers. Other industries may lose them.</p>
          <label>Industry<select id="subsidy-sector" v-model="subsidySector" name="sector"><option v-for="sector in SECTORS" :key="sector" :value="sector">{{ label(sector) }}</option></select></label>
          <div class="input-pair">
            <label>₡ / worker / month<input v-model.number="subsidyAmount" name="amount" type="number" min="0" max="3" step="0.05" required /></label>
            <label>Where<select v-model="subsidyScope" name="scope"><option value="national">Whole country</option><option value="selected" :disabled="!selected.size">Selected ({{ selected.size }})</option><option v-for="(region, index) in game.model.regions" :key="region" :value="String(index)">{{ region }}</option></select></label>
          </div>
          <button class="outline" :disabled="game.ended">Review subsidy →</button>
          <small>National grants replace local grants for that industry. Set zero to remove support.</small>
        </form>

        <form id="invest-form" class="policy-card" @submit.prevent="submitInvestment">
          <span class="card-icon">⌂</span><h3>Build something lasting</h3><p>A one-time improvement, paid from the treasury. Upkeep still matters.</p>
          <label>Project<select v-model="investmentProject" name="project"><option value="transport">Transport links</option><option value="hospital">Local hospitals</option><option value="school">Schools & training</option><option value="stadium">Community stadiums</option></select></label>
          <div class="input-pair">
            <label>Total investment (₡)<input v-model.number="investmentAmount" name="amount" type="number" min="1" step="100" required /></label>
            <label>Where<select v-model="investmentScope" name="scope"><option value="national">Whole country</option><option value="selected" :disabled="!selected.size">Selected ({{ selected.size }})</option><option v-for="(region, index) in game.model.regions" :key="region" :value="String(index)">{{ region }}</option></select></label>
          </div>
          <button class="outline" :disabled="game.ended">Review investment →</button>
        </form>
      </div>

      <div v-else-if="policyTab === 'laws'" class="law-list">
        <div v-for="law in LAWS" :key="law" class="law">
          <div>
            <h3>{{ lawInfo[law][0] }} <span class="status-pill" :class="{ on: policy.laws[law] }">{{ policy.laws[law] ? 'In force' : 'Not in force' }}</span></h3>
            <p>{{ lawInfo[law][1] }}</p>
          </div>
          <button class="outline" :disabled="game.ended" @click="toggleLaw(law)">{{ policy.laws[law] ? 'Review repeal' : 'Review enactment' }} →</button>
        </div>
      </div>

      <form v-else id="console-form" class="console-form" @submit.prevent="submitCommand">
        <p>Write a precise command, or submit a JSON action package. Every command is validated and previewed before enactment.</p>
        <label for="command">Government command</label>
        <textarea id="command" v-model="command" name="command" rows="4" spellcheck="false" placeholder="subsidize sports 1.5 in selected" required />
        <div class="console-actions"><code>tax income 0.25</code><code>spend police 0.35</code><code>law cleanAir on</code><button class="primary" :disabled="game.ended">Preview command →</button></div>
        <details><summary>Command reference</summary><pre>tax income|business RATE               # 0–0.65
spend SERVICE AMOUNT                   # 0–2 per resident
wage minimum AMOUNT                    # 0–10 per worker
subsidize SECTOR AMOUNT in SCOPE       # 0–3 per worker
invest transport|hospital|school|stadium AMOUNT in SCOPE
law cleanAir|freeMovement|publicAssembly|foodPriceControls on|off

SCOPE: national | selected | region 0 (through 3)</pre></details>
      </form>
    </div>

    <aside class="budget-note">
      <span class="eyebrow">THE PUBLIC PURSE</span><h3>Every promise has a price.</h3>
      <dl>
        <div><dt>Projected revenue</dt><dd>{{ formatMoney(forecast.revenue) }}</dd></div>
        <div><dt>Public spending</dt><dd>{{ formatMoney(forecast.spending) }}</dd></div>
        <div><dt>Debt interest</dt><dd>{{ formatMoney(forecast.interest) }}</dd></div>
        <div class="budget-total"><dt>Monthly balance</dt><dd :class="forecast.balance < 0 ? 'negative' : 'positive'">{{ forecast.balance > 0 ? '+' : '' }}{{ formatMoney(forecast.balance) }}</dd></div>
      </dl>
      <p>{{ budgetNarrative }}</p>
      <div class="debt-line">Public debt <strong>{{ formatMoney(game.model.debt) }}</strong></div>
      <details>
        <summary>Current allocations</summary>
        <dl>
          <div v-for="item in SERVICES" :key="item"><dt>{{ label(item) }}</dt><dd>₡{{ policy.spending[item].toFixed(2) }}</dd></div>
          <div v-for="sector in SECTORS" :key="sector"><dt>{{ label(sector) }} grant</dt><dd>₡{{ policy.subsidies[sector].toFixed(2) }}</dd></div>
        </dl>
        <p>{{ game.model.localSubsidies.length }} local grant overrides in effect.</p>
      </details>
      <p v-if="selected.size === 1">Selected mapxel grants: {{ SECTORS.map(sector => `${sector} ₡${subsidyFor(game.model, game.model.cells[[...selected][0]], sector).toFixed(2)}`).join(' · ') }}</p>
    </aside>
  </div>
</template>
