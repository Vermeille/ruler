<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { scopeCells } from '../sim/policy';
import type { Game } from '../sim/types';
import { attachMap, LAYERS, type Layer } from '../ui/map';

const props = defineProps<{
  game: Game;
  selected: Set<number>;
  layer: Layer;
  zoom: number;
  roads: boolean;
  running: boolean;
  darkMode: boolean;
}>();

const emit = defineEmits<{
  select: [ids: number[], additive: boolean];
  'update:layer': [layer: Layer];
  'update:zoom': [zoom: number];
  'update:roads': [roads: boolean];
}>();

const canvas = ref<HTMLCanvasElement>();
let destroyMap: (() => void) | undefined;

const currentLayer = computed(() => LAYERS.find(candidate => candidate.id === props.layer)!);
const usesGradient = computed(() => props.layer !== 'terrain' && props.layer !== 'industry');
const warmGradient = computed(() => props.layer === 'crime' || props.layer === 'pollution');

function mountMap(): void {
  destroyMap?.();
  if (!canvas.value) return;
  destroyMap = attachMap(canvas.value, {
    game: props.game,
    selected: props.selected,
    layer: props.layer,
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

onMounted(mountMap);
onBeforeUnmount(() => destroyMap?.());
watch(
  () => [props.game, props.selected, props.layer, props.zoom, props.roads, props.running, props.darkMode],
  () => void nextTick(mountMap),
  { flush: 'post' },
);
</script>

<template>
  <div class="map-panel panel">
    <div class="panel-heading">
      <div>
        <span class="eyebrow">A LIVING ATLAS</span>
        <h2>The Commonwealth <span class="subtle">/</span> <span class="map-view-title">{{ currentLayer.name }}</span></h2>
      </div>
      <select id="region" aria-label="Select a region" @change="chooseRegion">
        <option value="">Explore a region</option>
        <option v-for="(region, index) in game.model.regions" :key="region" :value="index">{{ region }}</option>
      </select>
    </div>

    <div class="layer-bar" role="group" aria-label="Map layers">
      <button
        v-for="candidate in LAYERS"
        :key="candidate.id"
        class="layer"
        :class="{ active: layer === candidate.id }"
        :aria-pressed="layer === candidate.id"
        @click="$emit('update:layer', candidate.id)"
      >
        {{ candidate.name }}
      </button>
    </div>

    <div class="map-wrap">
      <canvas ref="canvas" id="map" aria-label="Country map. Click a mapxel or drag to select an area. Use the region menu for keyboard selection." />
      <div id="map-tooltip" role="tooltip" />
      <div class="map-tools">
        <button id="zoom-in" aria-label="Zoom in" @click="zoomBy(0.2)">+</button>
        <button id="zoom-out" aria-label="Zoom out" @click="zoomBy(-0.2)">−</button>
        <button id="zoom-reset" aria-label="Reset zoom" @click="$emit('update:zoom', 1)">⌖</button>
      </div>
      <div class="map-badge"><span class="live-dot" /> {{ running ? 'Country evolving' : 'Time is paused' }}</div>
    </div>

    <div class="map-footer">
      <span>
        <i v-if="usesGradient" class="legend-gradient" :class="{ warm: warmGradient }" />
        <span v-else class="legend-dots">● ● ●</span>
        {{ currentLayer.low }} <span class="legend-high">{{ currentLayer.high }}</span>
      </span>
      <label><input id="roads" type="checkbox" :checked="roads" @change="setRoads" /> Neighbor links</label>
    </div>
  </div>
</template>
