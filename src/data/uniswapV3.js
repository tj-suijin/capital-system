// Uniswap V3 pool definitions, Swap log decoding and on-chain verification.
//
// Swap(address indexed sender, address indexed recipient, int256 amount0,
//      int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
import { E, TradingError } from '../shared/errors.js';

export const SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

const Q96 = 2 ** 96;

export const BASE_UNISWAP_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

// Prices are always quoted as `base` in units of `quote` (e.g. ETH in USDC).
export const POOLS = {
  'base:uniswap-v3:WETH/USDC:500': {
    id:       'base:uniswap-v3:WETH/USDC:500',
    symbol:   'ETH/USDC',
    venue:    'uniswap-v3',
    chain:    'base',
    address:  '0xd0b53D9277642d899DF5C87A3966A349A798F224', // verified on-chain Oct 13, 2026
    factory:  BASE_UNISWAP_V3_FACTORY,
    fee:      500,
    token0:   { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
    token1:   { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    baseIsToken0: true,
    // Sanity band; prices outside it are discarded as decode errors.
    minPrice: 100,
    maxPrice: 100_000,
  },
};

export function getPool(id) {
  const pool = POOLS[id];
  if (!pool) throw new TradingError(E.DATA_UNKNOWN_POOL, id);
  return pool;
}

export function sqrtPriceX96ToPrice(sqrtPriceX96, pool) {
  const ratio = (Number(BigInt(sqrtPriceX96)) / Q96) ** 2; // token1 per token0, raw units
  const token0InToken1 = ratio * 10 ** (pool.token0.decimals - pool.token1.decimals);
  return pool.baseIsToken0 ? token0InToken1 : 1 / token0InToken1;
}

function int256(hexWord) {
  const v = BigInt('0x' + hexWord);
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

// Returns { price, volumeQuote } from a Swap log's data field.
export function decodeSwapData(data, pool) {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length < 64 * 5) throw new Error('Swap log data too short');
  const amount0 = int256(hex.slice(0, 64));
  const amount1 = int256(hex.slice(64, 128));
  const sqrtPriceX96 = BigInt('0x' + hex.slice(128, 192));

  const quoteAmount = pool.baseIsToken0 ? amount1 : amount0;
  const quoteToken  = pool.baseIsToken0 ? pool.token1 : pool.token0;
  const abs = quoteAmount < 0n ? -quoteAmount : quoteAmount;

  return {
    price:       sqrtPriceX96ToPrice(sqrtPriceX96, pool),
    volumeQuote: Number(abs) / 10 ** quoteToken.decimals,
  };
}

const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];

// Confirms the pool address, token order and fee against the factory.
// Returns the current pool price.
export async function verifyPool(ethers, provider, pool) {
  const factory  = new ethers.Contract(pool.factory, FACTORY_ABI, provider);
  const contract = new ethers.Contract(pool.address, POOL_ABI, provider);
  const [fromFactory, t0, t1, fee, slot0] = await Promise.all([
    factory.getPool(pool.token0.address, pool.token1.address, pool.fee),
    contract.token0(), contract.token1(), contract.fee(), contract.slot0(),
  ]);

  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const problems = [];
  if (!same(fromFactory, pool.address))      problems.push(`factory returns ${fromFactory}`);
  if (!same(t0, pool.token0.address))        problems.push(`token0 is ${t0}`);
  if (!same(t1, pool.token1.address))        problems.push(`token1 is ${t1}`);
  if (Number(fee) !== pool.fee)              problems.push(`fee is ${fee}`);
  if (problems.length) throw new TradingError(E.DATA_POOL_MISMATCH, `${pool.id}: ${problems.join('; ')}`);

  return sqrtPriceX96ToPrice(slot0.sqrtPriceX96, pool);
}

export async function readPoolPrice(ethers, provider, pool) {
  const contract = new ethers.Contract(pool.address, POOL_ABI, provider);
  const slot0 = await contract.slot0();
  return sqrtPriceX96ToPrice(slot0.sqrtPriceX96, pool);
}
