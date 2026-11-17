import { createHash } from 'node:crypto';

export function conformanceFingerprint(configuration, browserVersion) {
  return createHash('sha256').update(JSON.stringify({ ...configuration, browserVersion })).digest('hex');
}

export function validateConformanceCheckpoint(previous, backend, fingerprint) {
  if (previous.fingerprint !== fingerprint) {
    throw new Error(`Checkpoint configuration changed for ${backend}. Use a new --output or --fresh.`);
  }
  if (previous.backend !== backend || !Array.isArray(previous.inventory)
    || previous.inventory.some(url => typeof url !== 'string' || !url)
    || new Set(previous.inventory).size !== previous.inventory.length || !Array.isArray(previous.results)) {
    throw new Error(`Invalid ${backend} checkpoint inventory or backend.`);
  }
  const indices = new Set();
  for (const record of previous.results) {
    if (record.backend !== backend || !Number.isSafeInteger(record.index) || record.index < 0
      || previous.inventory[record.index] !== record.url || indices.has(record.index)) {
      throw new Error(`Invalid ${backend} checkpoint result identity.`);
    }
    indices.add(record.index);
  }
}
