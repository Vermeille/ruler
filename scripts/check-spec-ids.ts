import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

interface Location {
  file: string;
  line: number;
}

const root = process.cwd();
const specsDir = join(root, 'specs');
const codeDir = join(root, 'src');
const codeExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue']);

const specEntryPattern = /^\[([IEX])\] ([A-Z][A-Z0-9-]*):\s+(.+)$/;
const codeReferencePattern = /\[I\]\s+([A-Z][A-Z0-9-]*)\b/g;

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return files.flat().sort();
}

function display(location: Location): string {
  return `${relative(root, location.file)}:${location.line}`;
}

async function readSpecIds(): Promise<{ ids: Map<string, Location>; errors: string[] }> {
  const ids = new Map<string, Location>();
  const errors: string[] = [];
  const files = (await walk(specsDir)).filter(file => extname(file) === '.md');

  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/^\[[IEX]/.test(line)) return;

      const match = line.match(specEntryPattern);
      const location = { file, line: index + 1 };
      if (!match) {
        errors.push(`${display(location)} has a malformed behavior entry; expected "[I] CODE: description", "[E] CODE: description", or "[X] CODE: description".`);
        return;
      }

      const [, status, id] = match;
      const previous = ids.get(id);
      if (previous) {
        errors.push(`${display(location)} duplicates ${id}, first declared at ${display(previous)}.`);
        return;
      }

      ids.set(id, location);
      if (status === 'E') {
        errors.push(`${display(location)} marks ${id} as edited; reconcile the code and change it back to [I].`);
      } else if (status === 'X') {
        errors.push(`${display(location)} marks ${id} for deletion; remove the behavior from code and delete this spec line.`);
      }
    });
  }

  return { ids, errors };
}

async function readCodeReferences(): Promise<{ refs: Map<string, Location[]>; errors: string[] }> {
  const refs = new Map<string, Location[]>();
  const errors: string[] = [];
  const files = (await walk(codeDir)).filter(file => codeExtensions.has(extname(file)));

  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.includes('[I]')) return;

      const matches = [...line.matchAll(codeReferencePattern)];
      const location = { file, line: index + 1 };
      if (matches.length === 0) {
        errors.push(`${display(location)} has a malformed behavior reference; expected "[I] CODE".`);
        return;
      }

      for (const match of matches) {
        const id = match[1];
        const locations = refs.get(id) ?? [];
        locations.push(location);
        refs.set(id, locations);
      }
    });
  }

  return { refs, errors };
}

const specs = await readSpecIds();
const code = await readCodeReferences();
const errors = [...specs.errors, ...code.errors];

for (const [id, location] of specs.ids) {
  if (!code.refs.has(id)) {
    errors.push(`${display(location)} declares ${id}, but no source file references it.`);
  }
}

for (const [id, locations] of code.refs) {
  if (!specs.ids.has(id)) {
    errors.push(`${locations.map(display).join(', ')} reference orphan behavior ID ${id}.`);
  }
}

if (errors.length > 0) {
  console.error('Behavior specification consistency check failed:\n');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const referenceCount = [...code.refs.values()].reduce((sum, locations) => sum + locations.length, 0);
console.log(`Behavior specifications OK: ${specs.ids.size} unique IDs, ${referenceCount} source references.`);
