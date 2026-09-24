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
  await expect(rulePicker).toContainText('Scarcity changes prices');
  await expect(lens).toContainText('economy.businesses');

  // Outputs are first-class graph centers. Crime should become the central node,
  // with resident drivers on the left and exact-path consumers on the right.
  await phases.getByRole('button', { name: /behavior/ }).click();
  await expect(page.getByRole('heading', { name: 'behavior', exact: true })).toBeVisible();
  await expect(rulePicker.getByRole('button', { name: /population.crime/ })).toHaveClass(/active/);
  const crimeOutput = graph.locator('.rule-graph-node-output').filter({ hasText: 'Crime' });
  await expect(crimeOutput).toBeVisible();
  await crimeOutput.click();
  await expect(graph).toHaveClass(/variable-centered/);
  await expect(graph).toContainText('VARIABLE GRAPH');
  await expect(graph).toContainText('What changes Crime');
  const crimeNode = graph.locator('.rule-graph-node-variable');
  await expect(crimeNode).toBeVisible();
  await expect(crimeNode).toContainText('Crime');
  await expect(crimeNode).toContainText('population.crime');
  await expect(graph.locator('.rule-graph-edge-input').first()).toBeVisible();
  await expect(graph.locator('.rule-graph-node-consumer').first()).toBeVisible();
  await expect(graph).toContainText('WHAT IT FEEDS');

  // Clicking the centered variable returns to the producer rule view.
  await crimeNode.click();
  await expect(graph).not.toHaveClass(/variable-centered/);
  await expect(graph.locator('.rule-graph-node-rule')).toContainText('population.crime');

  // Migration is quarterly. Month 1 should explain that the rule is dormant rather than
  // inventing inputs and outputs for a rule that returned before reading lived conditions.
  await phases.getByRole('button', { name: /migration/ }).click();
  await expect(page.getByRole('heading', { name: 'migration', exact: true })).toBeVisible();
  await expect(rulePicker.getByRole('button', { name: /^population\.migration(?:\s|$)/ })).toHaveClass(/active/);
  await expect(lens).toContainText('population.migration');
  const sampling = lens.locator('.analysis-sampling');
  await expect(sampling.locator('strong')).toHaveText('0');
  await expect(sampling).toContainText('local perturbations');
  await expect(sampling).toContainText('from 0 meaningful reads');
  await expect(graph.locator('.rule-graph-node-input')).toHaveCount(0);
  await expect(graph.locator('.rule-graph-node-output')).toHaveCount(0);

  await phases.getByRole('button', { name: /trade/ }).click();
  await expect(page.getByRole('heading', { name: 'trade', exact: true })).toBeVisible();
  await expect(lens).toContainText('economy.neighbor-trade');
  await expect(page.getByRole('listbox', { name: 'Simulation effects' })).toBeVisible();

  await page.getByLabel('Filter effects').fill('food');
  await expect(page.locator('.effect-row').first()).toBeVisible();
  await expect(page.locator('.effect-detail pre')).toBeVisible();

  await page.getByLabel('Inspect mapxel').selectOption({ index: 1 });
  await expect(page.locator('.dev-cell-panel')).toContainText('Cell inspector');

  // Advance the committed state twice. The workbench always previews the next month, so tick 2
  // displays month 3, where quarterly migration is active.
  await page.getByRole('button', { name: 'Commit month 1' }).click();
  await expect(page.locator('.dev-state-badge')).toContainText('tick 1');
  await page.getByRole('button', { name: 'Commit month 2' }).click();
  await expect(page.locator('.dev-state-badge')).toContainText('tick 2');
  await expect(page.getByRole('button', { name: 'Commit month 3' })).toBeVisible();

  await phases.getByRole('button', { name: /migration/ }).click();
  await expect(page.getByRole('heading', { name: 'migration', exact: true })).toBeVisible();
  await expect(rulePicker.getByRole('button', { name: /^population\.migration(?:\s|$)/ })).toHaveClass(/active/);
  await expect(lens).toContainText('population.migration');
  await expect(graph.locator('.rule-graph-node-input').filter({ hasText: 'Group Wealth' })).toBeVisible();
  await expect(graph.locator('.rule-graph-node-input').filter({ hasText: 'Group Wellbeing' })).toBeVisible();
  await expect(graph.locator('.rule-graph-node-output')).toContainText(['Population Group Flow']);
  await expect(graph.locator('.rule-graph-node-consumer').first()).toBeVisible();
  await expect(graph.locator('.rule-graph-feedback-edge')).toBeVisible();
  await expect(graph).toContainText('t → t+3 feedback');

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

  // Migration writes population that production reads on the following month. Following that
  // edge should recenter the workbench without pretending it rewound or fast-forwarded time.
  const nextProduction = graph.locator('.rule-graph-node-consumer.next').filter({ hasText: 'economy.production' });
  await expect(nextProduction).toBeVisible();
  await nextProduction.click();
  await expect(page.getByRole('heading', { name: 'production', exact: true })).toBeVisible();
  await expect(lens).toContainText('economy.production');
  await expect(page.locator('.phase-title-row')).toContainText('showing current month');
  await expect(page.locator('.dev-state-badge')).toContainText('tick 2');
  await expect(page.getByRole('button', { name: /Return to month/ })).toHaveCount(0);

  expect(errors).toEqual([]);
});