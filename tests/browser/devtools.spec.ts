import { test, expect } from '@playwright/test';

test('simulation workbench previews phases, effects, cells, and commits a month', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?dev=1');
  await expect(page.getByRole('heading', { name: 'See the engine think.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/simulation-workbench.png', fullPage: true });

  const phases = page.locator('.dev-phases');
  await expect(phases.getByRole('button', { name: /production/ })).toBeVisible();
  await expect(phases.getByRole('button', { name: /events/ })).toBeVisible();

  await phases.getByRole('button', { name: /trade/ }).click();
  await expect(page.getByRole('heading', { name: 'trade', exact: true })).toBeVisible();
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
