from pathlib import Path

path = Path('scripts/recalibrate-scenario-contracts.py')
text = path.read_text()

# Drought was fixed independently on the branch while the first gate was running.
start = text.find('# Drought:')
end = text.find('# Extreme scenarios:')
if start >= 0 and end > start:
    text = text[:start] + text[end:]

# Empty replacements are ordinary empty strings, not unterminated multiline literals.
text = text.replace('    """,\n)\n', '    "",\n)\n')
path.write_text(text)
