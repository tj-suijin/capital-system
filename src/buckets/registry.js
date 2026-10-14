// Bucket registry. Real bucket implementations replace the NullBucket
// factories here as they are built (one bucket at a time).
import * as ethers from 'ethers';
import { MarketData } from '../data/marketData.js';
import { ExerciserBucket } from './exerciser/exerciserBucket.js';
import { LiquidDirectionalBucket } from './liquidDirectional/liquidDirectionalBucket.js';
import { NullBucket } from './null/nullBucket.js';

// deps: { store, chain, registry }
const FACTORIES = {
  liquidDirectional: (id, cfg, deps) => new LiquidDirectionalBucket({
    id, config: cfg,
    market: new MarketData({ ethers, store: deps.store, market: cfg.market, chain: deps.chain }),
  }),
  degenMemecoin: (id, cfg) => new NullBucket({ id, config: cfg }),
  exerciser: (id, cfg, deps) => {
    const feed = deps.registry.get(cfg.feed);
    if (!feed?.livePrice) throw new Error(`Exerciser feed "${cfg.feed}" is not an enabled bucket with a live price, or is listed after the exerciser`);
    return new ExerciserBucket({ id, config: cfg, feed });
  },
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

export function createDefaultRegistry(config, deps = {}) {
  const registry = new BucketRegistry();
  for (const [id, cfg] of Object.entries(config.buckets)) {
    if (!cfg.enabled) continue;
    const factory = FACTORIES[id];
    if (!factory) throw new Error(`No bucket implementation registered for "${id}"`);
    registry.register(factory(id, cfg, { chain: config.chain, ...deps, registry }));
  }
  return registry;
}

export default BucketRegistry;
