import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadSiteMapping } from '../src/siteMapping.js';

function createTempFile(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'site-mapping-'));
  const filePath = join(dir, 'mapping.json');
  writeFileSync(filePath, JSON.stringify(contents, null, 2));
  return filePath;
}

describe('site mapping loader', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads and resolves site names case-insensitively', () => {
    const filePath = createTempFile({ 'Example.com': 42, 'Second Site': 17 });
    tempDirs.push(dirname(filePath));

    const mapping = loadSiteMapping({ filePath });

    expect(mapping.getSiteId('example.com')).toBe(42);
    expect(mapping.getSiteId('SECOND SITE')).toBe(17);
    expect(mapping.tryGetSiteId('missing-site')).toBeUndefined();

    const resolved = mapping.resolveMany(['example.com', 'second site']);
    expect(resolved).toEqual([
      { name: 'Example.com', siteId: 42 },
      { name: 'Second Site', siteId: 17 },
    ]);
  });

  it('throws a helpful error when the file is missing', () => {
    const missingPath = join(tmpdir(), 'does-not-exist', 'mapping.json');

    expect(() => loadSiteMapping({ filePath: missingPath })).toThrow(
      /Site mapping file not found at/
    );
  });

  it('throws when schema is not an object<string, number>', () => {
    const filePath = createTempFile({ 'Example.com': 'not-a-number' });
    tempDirs.push(dirname(filePath));

    expect(() => loadSiteMapping({ filePath })).toThrow(/must be a finite number/);
  });

  it('throws when looking up an unknown site', () => {
    const filePath = createTempFile({ 'Example.com': 42 });
    tempDirs.push(dirname(filePath));

    const mapping = loadSiteMapping({ filePath });

    expect(() => mapping.getSiteId('unknown.example')).toThrow(/Unknown site name/);
  });
});
