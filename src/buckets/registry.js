// Bucket registry. Real bucket implementations replace the NullBucket
// factories here as they are built (one bucket at a time).
import { NullBucket } from './null/nullBucket.js';

const FACTORIES = {
  liquidDirectional: (id, cfg) => new NullBucket({ id, config: cfg }),
  degenMemecoin:     (id, cfg) => new NullBucket({ id, config: cfg }),
};

export class BucketRegistry {
  constructor() {
    this._buckets = new Map();
  }

  register(bucket) {
    if (this._buckets.has(bucket.id)) throw new Error(`Bucket already registered: ${bucket.id}`);
    this._buckets.set(bucket.id, bucket);
    return this;
  }

  get(id) {
    return this._buckets.get(id) ?? null;
  }

  list() {
    return [...this._buckets.values()];
  }
}

export function createDefaultRegistry(config) {
  const registry = new BucketRegistry();
  for (const [id, cfg] of Object.entries(config.buckets)) {
    if (!cfg.enabled) continue;
    const factory = FACTORIES[id];
    if (!factory) throw new Error(`No bucket implementation registered for "${id}"`);
    registry.register(factory(id, cfg));
  }
  return registry;
}

export default BucketRegistry;
