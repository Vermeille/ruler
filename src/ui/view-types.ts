import type { Action } from '../sim/types';

export type DeskTab = 'cabinet' | 'ledger' | 'trends' | 'rules';
export type PolicyTab = 'budget' | 'development' | 'laws' | 'console';

export interface PolicyPreviewData {
  actions: Action[];
  descriptions: string[];
  monthlyChange: number;
  upfront: number;
  warnings: string[];
}
