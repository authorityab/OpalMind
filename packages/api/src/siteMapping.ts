import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizeSiteName(name: string): string {
  return name.trim().toLowerCase();
}

export interface SiteMappingEntry {
  name: string;
  siteId: number;
}

export class SiteMapping {
  private readonly entries: Map<string, SiteMappingEntry>;

  constructor(entries: Map<string, SiteMappingEntry>, private readonly sourcePath: string) {
    this.entries = entries;
  }

  getSourcePath(): string {
    return this.sourcePath;
  }

  getEntries(): SiteMappingEntry[] {
    return Array.from(this.entries.values());
  }

  getEntry(siteName: string): SiteMappingEntry {
    const normalized = normalizeSiteName(siteName);
    if (!normalized) {
      throw new Error('Site name cannot be empty.');
    }

    const entry = this.entries.get(normalized);
    if (!entry) {
      throw new Error(this.buildUnknownSiteMessage(siteName));
    }

    return entry;
  }

  tryGetSiteId(siteName: string): number | undefined {
    try {
      return this.getEntry(siteName).siteId;
    } catch {
      return undefined;
    }
  }

  getSiteId(siteName: string): number {
    return this.getEntry(siteName).siteId;
  }

  resolveMany(siteNames: Iterable<string>): SiteMappingEntry[] {
    const resolved: SiteMappingEntry[] = [];
    const seen = new Set<number>();

    for (const name of siteNames) {
      const entry = this.getEntry(name);
      if (seen.has(entry.siteId)) {
        continue;
      }
      resolved.push(entry);
      seen.add(entry.siteId);
    }

    return resolved;
  }

  private buildUnknownSiteMessage(siteName: string): string {
    const available = this.getEntries()
      .map((entry) => `"${entry.name}"`)
      .join(', ');
    const suffix = available ? ` Available sites: ${available}.` : ' No sites are defined in the mapping file.';
    return `Unknown site name "${siteName}". Update the mapping file at "${this.sourcePath}" to include it.${suffix}`;
  }
}

export interface LoadSiteMappingOptions {
  filePath?: string;
}

const DEFAULT_SITE_MAPPING_PATH = fileURLToPath(new URL('../../../config/site-mapping.example.json', import.meta.url));

function resolvePath(pathLike: string): string {
  if (pathLike.startsWith('file://')) {
    return fileURLToPath(pathLike);
  }

  return isAbsolute(pathLike) ? pathLike : resolve(pathLike);
}

export function loadSiteMapping(options: LoadSiteMappingOptions = {}): SiteMapping {
  const envPath = process.env.SITE_MAPPING_PATH?.trim();
  const configuredPath = options.filePath ?? (envPath ? envPath : DEFAULT_SITE_MAPPING_PATH);
  const absolutePath = resolvePath(configuredPath);

  let content: string;
  try {
    content = readFileSync(absolutePath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      throw new Error(
        `Site mapping file not found at "${absolutePath}". Set SITE_MAPPING_PATH or copy config/site-mapping.example.json.`
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read site mapping file at "${absolutePath}": ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Site mapping file "${absolutePath}" contains invalid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Site mapping file "${absolutePath}" must be a JSON object mapping site names to numeric ids.`);
  }

  const entries = new Map<string, SiteMappingEntry>();

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const normalized = normalizeSiteName(key);
    if (!normalized) {
      throw new Error(`Site mapping file "${absolutePath}" contains an empty site name.`);
    }

    if (entries.has(normalized)) {
      throw new Error(`Site mapping file "${absolutePath}" defines duplicate site name "${key}" (case-insensitive).`);
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Site mapping for "${key}" must be a finite number. Received ${JSON.stringify(value)}.`);
    }

    entries.set(normalized, { name: key, siteId: value });
  }

  return new SiteMapping(entries, absolutePath);
}
