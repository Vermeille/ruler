from pathlib import Path

path = Path('tests/rules.test.ts')
text = path.read_text()
text = text.replace(
    ".filter(effect => effect.kind === 'population-transfer' && effect.from === from)\n  .reduce((sum, effect) => sum + effect.amount, 0);",
    ".filter((effect): effect is Extract<Effect, { kind: 'population-transfer' }> =>\n    effect.kind === 'population-transfer' && effect.from === from)\n  .reduce((sum, effect) => sum + effect.amount, 0);",
    1,
)
text = text.replace(
    "const populationMoves = open.filter(e => e.kind === 'population-transfer' && e.from === a.id);",
    "const populationMoves = open.filter((effect): effect is Extract<Effect, { kind: 'population-transfer' }> =>\n    effect.kind === 'population-transfer' && effect.from === a.id);",
    1,
)
path.write_text(text)
