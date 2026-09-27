import { formatUnits, getAddress, type Address, type Hex } from 'viem';
import type { Config, Connector, CreateConnectorFn } from 'wagmi';
import {
  connect as wagmiConnect,
  disconnect as wagmiDisconnect,
  getAccount,
  getBalance,
  reconnect as wagmiReconnect,
  switchChain,
  watchAccount,
} from 'wagmi/actions';
import { CHAIN_ID, NONCE_KEY } from '@bnbplay/shared/constants';
import { env } from '../api/env';
import { ApiError, toApiError } from '../api/errors';
import { apiClient, authSession, getStream, isFakeMode } from '../api/runtime';
import { browserStorage } from '../api/storage';
import { stake18ToUsd } from '../game/units';
import { createNonceReader } from '../web3/arena';
import { WALLETCONNECT_CONNECTOR_ID, createWeb3Config, loadWalletConnectConnector } from '../web3/config';
import { GUEST_CONNECTOR_ID, exportGuestKey, forgetGuestKey, hasGuestKey } from '../web3/guest';
import { createWagmiSigner, type IntentSigner } from '../web3/signing';

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  chainId: number;
  balanceBNB: string;
  isDemoWallet: boolean;
  connectorId?: string | null;
  kind?: 'guest' | 'wallet' | null;
  creditsUsd?: number | null;
  lockedUsd?: number | null;
  sessionReady?: boolean;
}

export type SettlementStep = 'idle' | 'preparing' | 'signing' | 'submitted' | 'confirmed' | 'failed';

export type ConnectKind = 'guest' | 'injected' | 'walletConnect';

const DISCONNECTED: WalletState = {
  isConnected: false,
  address: null,
  chainId: CHAIN_ID,
  balanceBNB: '0.00',
  isDemoWallet: false,
  connectorId: null,
  kind: null,
  creditsUsd: null,
  lockedUsd: null,
  sessionReady: false,
};

const formatNative = (wei: bigint): string => {
  const value = Number(formatUnits(wei, 18));
  return value >= 1 || value === 0 ? value.toFixed(2) : value.toFixed(4);
};

const hasInjectedProvider = (): boolean => typeof window !== 'undefined' && 'ethereum' in window && window.ethereum !== undefined;

export class Web3Service {
  private state: WalletState = { ...DISCONNECTED };
  private listeners: Set<(state: WalletState) => void> = new Set();
  private config: Config | null = null;
  private initialized = false;

  public subscribe(listener: (state: WalletState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  public getState(): WalletState {
    return { ...this.state };
  }

  public getConfig(): Config {
    if (!this.config) {
      this.config = createWeb3Config({ env, storage: typeof window === 'undefined' ? null : browserStorage() });
    }
    if (!this.initialized) {
      this.initialized = true;
      this.attach(this.config);
    }
    return this.config;
  }

  public async connect(kind: ConnectKind): Promise<WalletState> {
    const config = this.getConfig();
    const current = getAccount(config);
    const { connector, id } = await this.resolveConnector(config, kind);
    if (current.status === 'connected' && current.connector?.id === id) return this.getState();
    if (current.status === 'connected') await wagmiDisconnect(config);
    try {
      await wagmiConnect(config, kind === 'walletConnect' ? { connector } : { connector, chainId: CHAIN_ID });
    } catch (error) {
      throw toApiError(error, 'NO_WALLET');
    }
    if (kind !== 'guest' && getAccount(config).chainId !== CHAIN_ID) {
      await switchChain(config, { chainId: CHAIN_ID }).catch(() => undefined);
    }
    this.syncFromAccount(config);
    return this.getState();
  }

  public async connectWallet(preferDemo: boolean = false): Promise<WalletState> {
    if (!preferDemo && hasInjectedProvider()) {
      try {
        return await this.connect('injected');
      } catch {
        return this.connect('guest');
      }
    }
    return this.connect('guest');
  }

  public disconnect() {
    const config = this.config;
    authSession.clear();
    getStream().setPlayer(null);
    this.state = { ...DISCONNECTED };
    this.notify();
    if (config) void wagmiDisconnect(config).catch(() => undefined);
  }

  public getSigner(): IntentSigner | null {
    if (!this.config || !this.state.isConnected || !this.state.address) return null;
    return createWagmiSigner(this.config, getAddress(this.state.address), this.state.kind === 'guest' ? 'guest' : 'wallet');
  }

  public async ensureSession(signer: IntentSigner | null = this.getSigner()): Promise<void> {
    if (isFakeMode() || !apiClient.isEnabled()) return;
    if (!signer) throw new ApiError('NO_WALLET', 'Connect or play as a guest first.');
    await authSession.ensure(signer);
    if (!this.state.sessionReady) {
      this.state = { ...this.state, sessionReady: true };
      this.notify();
    }
  }

  public readOpenNonce(player: Address, arena: Address): Promise<bigint> {
    return createNonceReader(this.getConfig())(player, arena, NONCE_KEY.open);
  }

  public hasGuest(): boolean {
    return hasGuestKey(browserStorage());
  }

  public exportGuestKey(): { address: Address; privateKey: Hex } | null {
    return exportGuestKey(browserStorage());
  }

  public async forgetGuest(): Promise<void> {
    if (this.state.kind === 'guest') {
      this.disconnect();
      if (this.config) await wagmiDisconnect(this.config).catch(() => undefined);
    }
    forgetGuestKey(browserStorage());
  }

  public async refreshBalances(): Promise<WalletState> {
    const address = this.state.address;
    if (!this.config || !address) return this.getState();
    const target = getAddress(address);
    const [native, ledger] = await Promise.allSettled([
      isFakeMode() ? Promise.resolve(null) : getBalance(this.config, { address: target, chainId: CHAIN_ID }),
      authSession.token(target) ? apiClient.balance() : Promise.resolve(null),
    ]);
    if (this.state.address !== address) return this.getState();
    const next: WalletState = { ...this.state };
    if (native.status === 'fulfilled' && native.value) next.balanceBNB = formatNative(native.value.value);
    if (ledger.status === 'fulfilled' && ledger.value) {
      next.creditsUsd = stake18ToUsd(ledger.value.available);
      next.lockedUsd = stake18ToUsd(ledger.value.locked);
    }
    this.state = next;
    this.notify();
    return this.getState();
  }

  /**
   * A guest's first session triggers an auto-drip on the server, but that endpoint returns
   * immediately without waiting for it (`onFirstGuestSession` is fire-and-forget) — the drip
   * still has to be sent, mined and picked up by the indexer before `/v1/me/balance` (a live
   * on-chain read) reflects it. A single refreshBalances() right after connecting can land in
   * that window and read a real `0`, which then reads as "not enough credits" even though
   * funds are already on the way. Poll a few times until a positive balance is observed (or a
   * `balance` SSE push updates it independently — either way this exits as soon as it does),
   * so a fresh guest's own first refresh doesn't race their own faucet drip.
   */
  private async pollForFunds(attempts = 6, delayMs = 1_000): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const state = await this.refreshBalances().catch(() => null);
      if (state && (state.creditsUsd ?? 0) > 0) return;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  /**
   * Executes the BNB Chain settlement checkpoint sequence (PRD §27)
   */
  public async executeSettlement(
    onStep: (step: SettlementStep, txHash?: string) => void
  ): Promise<string> {
    onStep('preparing');
    await new Promise((r) => setTimeout(r, 260));

    onStep('signing');
    await new Promise((r) => setTimeout(r, 280));

    const pseudoHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    onStep('submitted', pseudoHash);
    await new Promise((r) => setTimeout(r, 340));

    onStep('confirmed', pseudoHash);
    await new Promise((r) => setTimeout(r, 220));

    return pseudoHash;
  }

  public async runPracticeSettlement(onStep: (step: SettlementStep) => void, totalMs = 600): Promise<null> {
    const beat = totalMs / 3;
    onStep('preparing');
    await new Promise((r) => setTimeout(r, beat));
    onStep('submitted');
    await new Promise((r) => setTimeout(r, beat));
    onStep('confirmed');
    await new Promise((r) => setTimeout(r, beat));
    return null;
  }

  private async resolveConnector(config: Config, kind: ConnectKind): Promise<{ connector: Connector | CreateConnectorFn; id: string }> {
    if (kind === 'walletConnect') {
      const projectId = env.wcProjectId;
      if (!projectId) throw new ApiError('NO_WALLET', 'WalletConnect is not configured.');
      const existing = config.connectors.find((connector) => connector.id === WALLETCONNECT_CONNECTOR_ID);
      return { connector: existing ?? (await loadWalletConnectConnector(projectId)), id: WALLETCONNECT_CONNECTOR_ID };
    }
    if (kind === 'injected' && !hasInjectedProvider()) throw new ApiError('NO_WALLET', 'No browser wallet was found.');
    const id = kind === 'guest' ? GUEST_CONNECTOR_ID : 'injected';
    const connector = config.connectors.find((entry) => entry.id === id);
    if (!connector) throw new ApiError('NO_WALLET', `The ${kind} connector is unavailable.`);
    return { connector, id };
  }

  private attach(config: Config): void {
    watchAccount(config, { onChange: () => this.syncFromAccount(config) });
    getStream().on('balance', (balance) => {
      if (!this.state.isConnected) return;
      this.state = { ...this.state, creditsUsd: stake18ToUsd(balance.available), lockedUsd: stake18ToUsd(balance.locked) };
      this.notify();
    });
    void this.reconnectWalletConnect(config);
  }

  private async reconnectWalletConnect(config: Config): Promise<void> {
    const projectId = env.wcProjectId;
    if (!projectId || !config.storage) return;
    const recent = await config.storage.getItem('recentConnectorId');
    if (recent !== WALLETCONNECT_CONNECTOR_ID) return;
    const connector = await loadWalletConnectConnector(projectId);
    await wagmiReconnect(config, { connectors: [connector] }).catch(() => undefined);
  }

  private syncFromAccount(config: Config): void {
    const account = getAccount(config);
    if (account.status !== 'connected' || !account.address) {
      if (this.state.isConnected) {
        this.state = { ...DISCONNECTED };
        getStream().setPlayer(null);
        this.notify();
      }
      return;
    }
    const isGuest = account.connector?.id === GUEST_CONNECTOR_ID;
    const changed = this.state.address?.toLowerCase() !== account.address.toLowerCase();
    this.state = {
      ...this.state,
      isConnected: true,
      address: account.address,
      chainId: account.chainId ?? CHAIN_ID,
      isDemoWallet: isGuest,
      connectorId: account.connector?.id ?? null,
      kind: isGuest ? 'guest' : 'wallet',
      ...(changed ? { balanceBNB: '0.00', creditsUsd: null, lockedUsd: null, sessionReady: false } : {}),
    };
    this.notify();
    if (!changed) return;
    getStream().setPlayer(account.address);
    if (isGuest) void this.ensureSession().catch(() => undefined).then(() => this.pollForFunds());
    else void this.refreshBalances().catch(() => undefined);
  }

  private notify() {
    this.listeners.forEach((l) => l(this.state));
  }
}

export const web3Service = new Web3Service();
