import { Contract, JsonRpcProvider, Network } from 'ethers';
import { DEFAULT_BSC_FALLBACK_RPCS, ERC20_TRANSFER_TOPIC } from '../../server/payouts/constants';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
];

export interface QuorumReceipt {
  hash: string;
  status: number;
  blockNumber: number;
  confirmations: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

export interface QuorumFeeData {
  gasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  supportsEip1559: boolean;
}

export interface RpcPoolInterface {
  readonly chainId: number;
  verifyHealthAndChainIds(): Promise<number>;
  quorumBlockNumber(): Promise<number>;
  quorumNativeBalance(address: string): Promise<bigint>;
  quorumTokenBalance(tokenAddress: string, holderAddress: string): Promise<bigint>;
  quorumTransactionCount(address: string, blockTag: 'latest' | 'pending'): Promise<number>;
  simulateCall(tx: { from: string; to: string; data: string }): Promise<void>;
  estimateGas(tx: { from: string; to: string; data: string }): Promise<bigint>;
  feeData(maxGwei: number): Promise<QuorumFeeData>;
  broadcastAll(rawTx: string): Promise<{ acceptedBy: string[]; firstError?: string }>;
  getQuorumReceipt(txHash: string): Promise<QuorumReceipt | null>;
}

interface ManagedProvider {
  url: string;
  provider: JsonRpcProvider;
  quarantinedUntil: number;
}

const LAG_THRESHOLD_BLOCKS = 5;
const QUARANTINE_MS = 5 * 60 * 1000;

export function parseConfiguredRpcUrls(): string[] {
  const fromEnv = (process.env.BSC_RPC_URLS || process.env.BSC_RPC_URL || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  const merged = Array.from(new Set([...fromEnv, ...DEFAULT_BSC_FALLBACK_RPCS]));
  return merged;
}

/**
 * Multi-operator BSC RPC pool with chainId pinning, block-lag quarantine, and 2-of-N quorum reads.
 *
 * Mitigates:
 * - Compromised or hijacked public RPC spoofing receipts ("Tx mined" when it did not).
 * - Wrong-chain / fork replay via staticNetwork + explicit eth_chainId assertions.
 * - Lagging RPCs returning stale nonces causing nonce collisions or censorship stalling broadcasts.
 */
export class BscRpcPool implements RpcPoolInterface {
  readonly chainId: number;
  private readonly nodes: ManagedProvider[];
  private readonly minQuorum: number;

  constructor(urls: string[], chainId: number, minQuorum = 2) {
    if (urls.length < 3) {
      throw new Error(`RPC pool requires at least 3 distinct fallback RPC URLs (got ${urls.length}).`);
    }
    this.chainId = chainId;
    this.minQuorum = minQuorum;

    const net = Network.from(chainId);
    this.nodes = urls.map((url) => ({
      url,
      // staticNetwork pins chainId so ethers never silently adapts to a hijacked chain
      provider: new JsonRpcProvider(url, net, { staticNetwork: net, batchMaxCount: 1 }),
      quarantinedUntil: 0,
    }));
  }

  private getHealthyNodes(): ManagedProvider[] {
    const now = Date.now();
    const active = this.nodes.filter((n) => n.quarantinedUntil <= now);
    return active.length >= this.minQuorum ? active : this.nodes;
  }

  async verifyHealthAndChainIds(): Promise<number> {
    const results = await Promise.allSettled(
      this.nodes.map(async (node) => {
        const [net, tip] = await Promise.all([
          node.provider.getNetwork(),
          node.provider.getBlockNumber(),
        ]);
        if (Number(net.chainId) !== this.chainId) {
          throw new Error(`Unexpected chainId ${net.chainId} (expected ${this.chainId})`);
        }
        return { node, tip };
      })
    );

    const alive: Array<{ node: ManagedProvider; tip: number }> = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        alive.push(r.value);
      } else {
        this.nodes[i].quarantinedUntil = Date.now() + QUARANTINE_MS;
      }
    }

    if (alive.length < this.minQuorum) {
      throw new Error(
        `RPC quorum unavailable: only ${alive.length}/${this.nodes.length} healthy providers respond on chain ${this.chainId}.`
      );
    }

    const maxTip = Math.max(...alive.map((a) => a.tip));
    const now = Date.now();
    for (const item of alive) {
      if (maxTip - item.tip > LAG_THRESHOLD_BLOCKS) {
        item.node.quarantinedUntil = now + QUARANTINE_MS;
      } else {
        item.node.quarantinedUntil = 0;
      }
    }

    return maxTip;
  }

  private async queryQuorum<T>(
    fn: (p: JsonRpcProvider) => Promise<T>,
    equals: (a: T, b: T) => boolean
  ): Promise<T> {
    const healthy = this.getHealthyNodes();
    const settled = await Promise.allSettled(healthy.map((n) => fn(n.provider)));
    const values: T[] = [];
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        values.push(s.value);
      }
    }

    for (let i = 0; i < values.length; i++) {
      let matches = 0;
      for (let j = 0; j < values.length; j++) {
        if (equals(values[i], values[j])) matches += 1;
      }
      if (matches >= this.minQuorum) return values[i];
    }

    throw new Error(
      `RPC quorum disagreement or failure (${values.length}/${healthy.length} responded cleanly).`
    );
  }

  async quorumBlockNumber(): Promise<number> {
    const healthy = this.getHealthyNodes();
    const settled = await Promise.allSettled(healthy.map((n) => n.provider.getBlockNumber()));
    const tips = settled
      .filter((s): s is PromiseFulfilledResult<number> => s.status === 'fulfilled')
      .map((s) => s.value)
      .sort((a, b) => a - b);

    if (tips.length < this.minQuorum) {
      throw new Error('Could not obtain quorum block number from BSC RPC pool.');
    }
    return tips[Math.floor(tips.length / 2)];
  }

  async quorumNativeBalance(address: string): Promise<bigint> {
    return this.queryQuorum(
      (p) => p.getBalance(address),
      (a, b) => a === b
    );
  }

  async quorumTokenBalance(tokenAddress: string, holderAddress: string): Promise<bigint> {
    return this.queryQuorum(
      async (p) => {
        const token = new Contract(tokenAddress, ERC20_ABI, p);
        return (await token.balanceOf(holderAddress)) as bigint;
      },
      (a, b) => a === b
    );
  }

  async quorumTransactionCount(address: string, blockTag: 'latest' | 'pending'): Promise<number> {
    return this.queryQuorum(
      (p) => p.getTransactionCount(address, blockTag),
      (a, b) => a === b
    );
  }

  async simulateCall(tx: { from: string; to: string; data: string }): Promise<void> {
    const healthy = this.getHealthyNodes();
    let lastErr: unknown;
    for (const node of healthy) {
      try {
        await node.provider.call(tx);
        return;
      } catch (err) {
        lastErr = err;
        // Deterministic contract execution revert — do not retry across nodes
        const msg = err instanceof Error ? err.message : String(err);
        if (/revert|CALL_EXCEPTION|insufficient|execution reverted/i.test(msg)) {
          throw err;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Pre-flight eth_call failed across all RPCs.');
  }

  async estimateGas(tx: { from: string; to: string; data: string }): Promise<bigint> {
    const healthy = this.getHealthyNodes();
    let lastErr: unknown;
    for (const node of healthy) {
      try {
        return await node.provider.estimateGas(tx);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/revert|CALL_EXCEPTION|insufficient|execution reverted/i.test(msg)) {
          throw err;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('eth_estimateGas failed across all RPCs.');
  }

  async feeData(maxGwei: number): Promise<QuorumFeeData> {
    const capWei = BigInt(Math.floor(maxGwei * 1_000_000_000));
    const healthy = this.getHealthyNodes();
    for (const node of healthy) {
      try {
        const fd = await node.provider.getFeeData();
        const baseGas = fd.gasPrice ?? fd.maxFeePerGas ?? 1_000_000_000n;
        const maxFee = fd.maxFeePerGas ?? baseGas;
        const maxPriority = fd.maxPriorityFeePerGas ?? (baseGas > 100_000_000n ? baseGas : 100_000_000n);
        if (maxFee > capWei || baseGas > capWei) {
          throw new Error(`Network gas price exceeds safety ceiling (${maxGwei} gwei).`);
        }
        return {
          gasPrice: baseGas,
          maxFeePerGas: maxFee,
          maxPriorityFeePerGas: maxPriority > maxFee ? maxFee : maxPriority,
          supportsEip1559: fd.maxFeePerGas !== null && fd.maxPriorityFeePerGas !== null,
        };
      } catch (err) {
        if (err instanceof Error && err.message.includes('safety ceiling')) throw err;
      }
    }
    throw new Error('Could not retrieve fee data from any healthy BSC RPC.');
  }

  async broadcastAll(rawTx: string): Promise<{ acceptedBy: string[]; firstError?: string }> {
    const healthy = this.getHealthyNodes();
    const settled = await Promise.allSettled(
      healthy.map(async (node) => {
        const hash = (await node.provider.send('eth_sendRawTransaction', [rawTx])) as string;
        return { url: node.url, hash };
      })
    );

    const acceptedBy: string[] = [];
    let firstError: string | undefined;

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        acceptedBy.push(s.value.url);
      } else {
        const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
        // "already known" means a sibling node already propagated this exact signed tx cleanly
        if (/already known|known transaction|Transaction already imported/i.test(msg)) {
          acceptedBy.push(healthy[i].url);
        } else if (!firstError) {
          firstError = msg;
        }
      }
    }

    return { acceptedBy, firstError };
  }

  async getQuorumReceipt(txHash: string): Promise<QuorumReceipt | null> {
    const healthy = this.getHealthyNodes();
    const settled = await Promise.allSettled(
      healthy.map(async (node) => {
        const [receipt, tip] = await Promise.all([
          node.provider.getTransactionReceipt(txHash),
          node.provider.getBlockNumber(),
        ]);
        if (!receipt) return null;
        return {
          hash: receipt.hash.toLowerCase(),
          status: receipt.status ?? 0,
          blockNumber: receipt.blockNumber,
          confirmations: Math.max(1, tip - receipt.blockNumber + 1),
          gasUsed: receipt.gasUsed,
          effectiveGasPrice: receipt.gasPrice ?? 0n,
          logs: receipt.logs.map((l) => ({
            address: l.address.toLowerCase(),
            topics: l.topics.map((t) => t.toLowerCase()),
            data: l.data.toLowerCase(),
          })),
        };
      })
    );

    const receipts = settled
      .filter((s): s is PromiseFulfilledResult<QuorumReceipt | null> => s.status === 'fulfilled')
      .map((s) => s.value)
      .filter((v): v is QuorumReceipt => v !== null);

    if (receipts.length < this.minQuorum) {
      return null;
    }

    // Require quorum agreement on blockNumber, status, and matching Transfer log hash count
    for (let i = 0; i < receipts.length; i++) {
      const candidate = receipts[i];
      const transferSigA = candidate.logs
        .filter((l) => l.topics[0] === ERC20_TRANSFER_TOPIC)
        .map((l) => `${l.address}:${l.topics.join(',')}:${l.data}`)
        .join('|');

      let agreeing = 0;
      let minConf = candidate.confirmations;
      for (const other of receipts) {
        const transferSigB = other.logs
          .filter((l) => l.topics[0] === ERC20_TRANSFER_TOPIC)
          .map((l) => `${l.address}:${l.topics.join(',')}:${l.data}`)
          .join('|');

        if (
          other.hash === candidate.hash &&
          other.status === candidate.status &&
          other.blockNumber === candidate.blockNumber &&
          transferSigA === transferSigB
        ) {
          agreeing += 1;
          minConf = Math.min(minConf, other.confirmations);
        }
      }

      if (agreeing >= this.minQuorum) {
        return { ...candidate, confirmations: minConf };
      }
    }

    return null;
  }
}
