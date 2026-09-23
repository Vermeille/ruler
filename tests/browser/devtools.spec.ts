import { test, expect } from '@playwright/test';

test('simulation workbench explains rules visually and preserves the forensic inspector', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?dev=1');
  await expect(page.getByRole('heading', { name: 'See the engine think.' })).toBeVisible();

  const phases = page.locator('.dev-phases');
  const lens = page.locator('.rule-lens');
  const graph = lens.locator('.rule-graph-card');
  const rulePicker = page.locator('[aria-label="Rules in this phase"]');
  await expect(phases.getByRole('button', { name: /production/ })).toBeVisible();
  await expect(phases.getByRole('button', { name: /events/ })).toBeVisible();

  await expect(rulePicker).toContainText('1 rule');
  await expect(rulePicker.getByRole('button', { name: /economy.production/ })).toHaveClass(/active/);
  await expect(lens).toContainText('economy.production');
  await expect(graph).toBeVisible();
  await expect(graph.locator('.rule-graph-node-input')).toContainText(['Random · Weather']);
  await expect(graph.locator('.rule-graph-node-output').first()).toBeVisible();
  const productionInputEdge = graph.locator('.rule-graph-edge-input').first();
  await expect(productionInputEdge).toBeVisible();
  expect(Number(await productionInputEdge.getAttribute('stroke-width'))).toBeGreaterThan(1.5);
  await expect(lens.locator('.footprint-cell-block').first()).toBeVisible();

  const lensContained = await lens.evaluate(element => element.scrollWidth <= element.clientWidth + 1);
  expect(lensContained).toBe(true);

  await phases.getByRole('button', { name: /market/ }).click();
  await expect(page.getByRole('heading', { name: 'market', exact: true })).toBeVisible();
  await expect(rulePicker).toContainText('1 rule');
  await expect(rulePicker.getByRole('button', { name: /economy.businesses/ })).toHaveClass(/active/);
  await expect(rulePicker).toContainText('Scarcity changes local prices');
  await expect(lens).toContainText('economy.businesses');

  await phases.getByRole('button', { name: /migration/ }).click();
  await expect(page.getByRole('heading', { name: 'migration', exact: true })).toBeVisible();
  await expect(rulePicker.getByRole('button', { name: /society.migration/ })).toHaveClass(/active/);
  await expect(lens).toContainText('society.migration');
  await expect(graph.locator('.rule-graph-node-input')).toContainText(['Cell Happiness']);
  await expect(graph.locator('.rule-graph-node-output')).toContainText(['Population Flow']);
  await expect(graph.locator('.rule-graph-node-consumer').first()).toBeVisible();
  await expect(graph.locator('.rule-graph-feedback-edge')).toBeVisible();
  await expect(graph).toContainText('t → t+1 feedback');

  const graphBox = await graph.locator('.rule-graph-scroll').boundingBox();
  const outputBox = await graph.locator('.rule-graph-node-output').first().boundingBox();
  const consumerBox = await graph.locator('.rule-graph-node-consumer').first().boundingBox();
  expect(graphBox).not.toBeNull();
  expect(outputBox).not.toBeNull();
  expect(consumerBox).not.toBeNull();
  expect(outputBox!.x + outputBox!.width).toBeLessThanOrEqual(graphBox!.x + graphBox!.width + 1);
  expect(consumerBox!.x + consumerBox!.width).toBeLessThanOrEqual(graphBox!.x + graphBox!.width + 1);

  await expect(lens).toContainText('MAP WRITES');
  await expect(lens).toContainText('Bright cells simply mean this rule writes more strongly there');
  await expect(lens.locator('.footprint-cell-block').first()).toBeVisible();
  expect(await lens.locator('.footprint-flow').count()).toBeGreaterThan(0);
  await expect(lens.locator('.flow-rank-row').first()).toBeVisible();
  await expect(lens.locator('.downstream-track')).toBeVisible();

  await page.screenshot({ path: 'test-results/simulation-workbench.png', fullPage: true });

  // Input nodes follow exact state paths back to their writer.
  await graph.locator('.rule-graph-node-input').filter({ hasText: 'Cell Happiness' }).click();
  await expect(page.getByRole('heading', { name: 'society', exact: true })).toBeVisible();
  await expect(lens).toContainText('society.wellbeing');
  await expect(page.locator('.phase-title-row')).toContainText('Followed this month producer');

  // Same-month consumer nodes recenter directly on the downstream rule.
  await phases.getByRole('button', { name: /migration/ }).click();
  await graph.locator('.rule-graph-node-consumer').filter({ hasText: 'economy.labor' }).click();
  await expect(page.getByRole('heading', { name: 'adaptation', exact: true })).toBeVisible();
  await expect(lens).toContainText('economy.labor');

  // Next-month consumers open the exact next preview tick rather than a lookalike current-tick rule.
  await phases.getByRole('button', { name: /migration/ }).click();
  const nextProduction = graph.locator('.rule-graph-node-consumer.next').filter({ hasText: 'economy.production' });
  await expect(nextProduction).toBeVisible();
  await nextProduction.click();
  await expect(page.locator('.dev-panel-heading').first()).toContainText('Month 2');
  await expect(page.getByRole('heading', { name: 'production', exact: true })).toBeVisible();
  await expect(lens).toContainText('economy.production');
  await expect(page.getByRole('button', { name: 'Return to month 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to month 1' }).click();

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
