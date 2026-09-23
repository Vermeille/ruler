import { test, expect } from '@playwright/test';

test('simulation workbench explains rules visually and preserves the forensic inspector', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?dev=1');
  await expect(page.getByRole('heading', { name: 'See the engine think.' })).toBeVisible();

  const phases = page.locator('.dev-phases');
  const lens = page.locator('.rule-lens');
  await expect(phases.getByRole('button', { name: /production/ })).toBeVisible();
  await expect(phases.getByRole('button', { name: /events/ })).toBeVisible();

  await expect(lens).toContainText('economy.production');
  await expect(lens.locator('.sensitivity-card')).toContainText('Random · Weather');
  await expect(lens.locator('.sensitivity-bar i').first()).toBeVisible();
  await expect(lens.locator('.footprint-cell-block').first()).toBeVisible();

  await phases.getByRole('button', { name: /migration/ }).click();
  await expect(page.getByRole('heading', { name: 'migration', exact: true })).toBeVisible();
  await expect(lens).toContainText('society.migration');
  await expect(lens.locator('.sensitivity-card')).toContainText('Cell Happiness');
  await expect(lens.locator('.rule-output-strip')).toContainText('Population Flow');
  await expect(lens.locator('.footprint-cell-block').first()).toBeVisible();
  await expect(lens.locator('.footprint-flow').first()).toBeVisible();
  await expect(lens.locator('.downstream-track')).toBeVisible();

  await page.screenshot({ path: 'test-results/simulation-workbench.png', fullPage: true });

  await phases.getByRole('button', { name: /trade/ }).click();
  await expect(page.getByRole('heading', { name: 'trade', exact: true })).toBeVisible();
  await expect(lens).toContainText('economy.neighbor-trade');
  await expect(page.getByRole('listbox', { name: 'Simulation effects' })).toBeVisible();

  await page.getByLabel('Filter effects').fill('food');
  await expect(page.locator('.effect-row').first()).toBeVisible();
  await expect(page.locator('.effect-detail pre')).toBeVisible();

  await page.getByLabel('Inspect mapxel').selectOption({ index: 1 });
  await expect(page.locator('.dev-cell-panel')).toContainText('Cell inspector');

  await page.getByRole('button', { name: 'Commit month 1' }).click();
  await expect(page.locator('.dev-state-badge')).toContainText('tick 1');
  await expect(page.getByRole('button', { name: 'Commit month 2' })).toBeVisible();

  expect(errors).toEqual([]);
});