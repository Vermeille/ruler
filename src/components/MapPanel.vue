<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { scopeCells } from '../sim/policy';
import type { Game } from '../sim/types';
import { attachMap } from '../ui/map';
import { ALL_LAYERS, LAYERS, type Layer } from '../ui/map-layers';

const props = defineProps<{
  game: Game;
  selected: Set<number>;
  layers: Layer[];
  zoom: number;
  roads: boolean;
  running: boolean;
  darkMode: boolean;
}>();

const emit = defineEmits<{
  select: [ids: number[], additive: boolean];
  'update:layers': [layers: Layer[]];
  'update:zoom': [zoom: number];
  'update:roads': [roads: boolean];
}>();

const canvas = ref<HTMLCanvasElement>();
let destroyMap: (() => void) | undefined;

const activeLayerIds = computed(() => new Set(props.layers));
const isOverview = computed(() => (
  props.layers.length === ALL_LAYERS.length
  && ALL_LAYERS.every(layer => activeLayerIds.value.has(layer))
));
const singleLayer = computed(() => props.layers.length === 1
  ? LAYERS.find(candidate => candidate.id === props.layers[0])
  : undefined);
const currentViewTitle = computed(() => {
  if (isOverview.value) return 'Overview';
  if (singleLayer.value) return singleLayer.value.name;
  return `${props.layers.length} layers`;
});
const usesGradient = computed(() => singleLayer.value
  && !['industry', 'trade', 'events'].includes(singleLayer.value.id));
const warmGradient = computed(() => singleLayer.value?.id === 'crime' || singleLayer.value?.id === 'pollution');
const layerSummary = computed(() => {
  if (isOverview.value) return 'All signals summarized together';
  if (singleLayer.value) return '';
  const names = LAYERS.filter(layer => activeLayerIds.value.has(layer.id)).map(layer => layer.name);
  return `${names.join(' · ')}`;
});

function mountMap(): void {
  destroyMap?.();
  if (!canvas.value) return;
  destroyMap = attachMap(canvas.value, {
    game: props.game,
    selected: props.selected,
    layers: props.layers,
    zoom: props.zoom,
    roads: props.roads,
    running: props.running,
    onSelect: (ids, additive) => emit('select', ids, additive),
  });
}

function chooseRegion(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === '') return;
  emit('select', scopeCells(props.game.model, { kind: 'region', id: Number(value) }), false);
}

function setRoads(event: Event): void {
  emit('update:roads', (event.target as HTMLInputElement).checked);
}

function zoomBy(delta: number): void {
  emit('update:zoom', Math.max(0.6, Math.min(2, props.zoom + delta)));
}

function showOverview(): void {
  emit('update:layers', [...ALL_LAYERS]);
}

function toggleLayer(layer: Layer): void {
  if (isOverview.value) {
    emit('update:layers', [layer]);
    return;
  }

  const next = new Set(props.layers);
  if (next.has(layer)) next.delete(layer);
  else next.add(layer);

  if (next.size === 0) {
    showOverview();
    return;
  }

  emit('update:layers', LAYERS.filter(candidate => next.has(candidate.id)).map(candidate => candidate.id));
}

onMounted(mountMap);
onBeforeUnmount(() => destroyMap?.());
watch(
  () => [props.game, props.selected, props.layers.join('|'), props.zoom, props.roads, props.running, props.darkMode],
  () => void nextTick(mountMap),
  { flush: 'post' },
);
</script>

<template>
  <div class="map-panel panel">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">A LIVING ATLAS</span>
        <h2>The Commonwealth <span class="subtle">/</span> <span class="map-view-title">{{ currentViewTitle }}</span></h2>
      </div>
      <select id="region" aria-label="Select a region" @change="chooseRegion">
        <option value="">Explore a region</option>
        <option v-for="(region, index) in game.model.regions" :key="region" :value="index">{{ region }}</option>
      </select>
    </div>

    <div class="layer-bar" role="group" aria-label="Visible map layers">
      <button
        class="layer"
        :class="{ active: isOverview }"
        :aria-pressed="isOverview"
        title="Show a summary of every map layer"
        @click="showOverview"
      >
        Overview
      </button>
      <button
        v-for="candidate in LAYERS"
        :key="candidate.id"
        class="layer"
        :class="{ active: activeLayerIds.has(candidate.id) && !isOverview }"
        :aria-pressed="activeLayerIds.has(candidate.id)"
        :title="`Toggle ${candidate.name} layer`"
        @click="toggleLayer(candidate.id)"
      >
        {{ candidate.name }}
      </button>
    </div>

    <div class="map-wrap">
      <canvas ref="canvas" id="map" aria-label="Country map. Click a mapxel or drag to select an area. Use the map layers to filter visible signals." />
      <div id="map-tooltip" role="tooltip" />
      <div class="map-tools">
        <button id="zoom-in" aria-label="Zoom in" @click="zoomBy(0.2)">+</button>
        <button id="zoom-out" aria-label="Zoom out" @click="zoomBy(-0.2)">−</button>
        <button id="zoom-reset" aria-label="Reset zoom" @click="$emit('update:zoom', 1)">⌖</button>
      </div>
      <div class="map-badge"><span class="live-dot" /> {{ running ? 'Country evolving' : 'Time is paused' }}</div>
    </div>

    <div class="map-footer">
      <span v-if="singleLayer">
        <i v-if="usesGradient" class="legend-gradient" :class="{ warm: warmGradient }" />
        <span v-else class="legend-dots">● ● ●</span>
        {{ singleLayer.low }} <span class="legend-high">{{ singleLayer.high }}</span>
      </span>
      <span v-else><span class="legend-dots">● ● ●</span> {{ layerSummary }}</span>
      <label><input id="roads" type="checkbox" :checked="roads" @change="setRoads" /> Neighbor links</label>
    </div>
  </div>
</template>
