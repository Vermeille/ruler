export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

export function formatCompact(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(2)}m`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(0);
}

export function formatMoney(value: number): string {
  const sign = value < 0 ? '−' : '';
  return `${sign}₡${formatCompact(Math.abs(value))}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function formatMonth(tick: number): string {
  return new Date(Date.UTC(2032, tick, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function label(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}
