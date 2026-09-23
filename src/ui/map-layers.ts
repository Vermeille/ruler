export type Layer =
  | 'approval'
  | 'wealth'
  | 'foodSecurity'
  | 'crime'
  | 'population'
  | 'pollution'
  | 'industry'
  | 'trade'
  | 'events';

export interface LayerDefinition {
  id: Layer;
  name: string;
  low: string;
  high: string;
}

export const LAYERS: readonly LayerDefinition[] = [
  { id: 'approval', name: 'Public approval', low: 'Low approval', high: 'High approval' },
  { id: 'wealth', name: 'Prosperity', low: '₡0 / resident', high: '₡70+' },
  { id: 'foodSecurity', name: 'Food access', low: 'Unmet needs', high: 'Fully fed' },
  { id: 'crime', name: 'Crime', low: 'Low pressure', high: 'High pressure' },
  { id: 'population', name: 'Population', low: 'Sparse', high: 'Dense' },
  { id: 'pollution', name: 'Pollution', low: 'Clean', high: 'Polluted' },
  { id: 'industry', name: 'Economy', low: 'Farms · factories · services · sports', high: '' },
  { id: 'trade', name: 'Trade', low: 'Neighbor exchanges', high: 'Stronger flows' },
  { id: 'events', name: 'Events', low: 'Recent causes', high: 'Larger pulses' },
];

export const ALL_LAYERS: readonly Layer[] = LAYERS.map(layer => layer.id);

export type HeatmapLayer = Exclude<Layer, 'trade' | 'events'>;

const HEATMAP_LAYER_SET = new Set<Layer>([
  'approval',
  'wealth',
  'foodSecurity',
  'crime',
  'population',
  'pollution',
  'industry',
]);

export function isHeatmapLayer(layer: Layer): layer is HeatmapLayer {
  return HEATMAP_LAYER_SET.has(layer);
}
