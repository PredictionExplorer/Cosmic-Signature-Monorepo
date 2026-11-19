import {
  getEnvValidation,
  getPublicClientRpcUrl,
  networkConfig,
  REQUIRED_ENV_VARS,
} from '../networks';

const ORIGINAL_ENV = process.env;

function setValidEnv() {
  process.env = {
    ...ORIGINAL_ENV,
    NEXT_PUBLIC_NETWORK: 'mainnet',
    NEXT_PUBLIC_API_URL: 'https://api.example.com/api/cosmicgame/',
    NEXT_PUBLIC_RPC_URL: 'https://arb1.example-rpc.test',
    NEXT_PUBLIC_API_URLS: '',
    NEXT_PUBLIC_RPC_URLS: '',
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: '054b2b65ef55a96e408a3c1e5d15953e',
  };
}

describe('network environment validation', () => {
  beforeEach(() => {
    setValidEnv();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('lists the WalletConnect project id as a required environment variable', () => {
    expect(REQUIRED_ENV_VARS).toEqual([
      'NEXT_PUBLIC_NETWORK',
      'NEXT_PUBLIC_API_URL',
      'NEXT_PUBLIC_RPC_URL',
      'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
    ]);
  });

  it('accepts a complete network and wallet environment', () => {
    expect(getEnvValidation()).toEqual({ valid: true, missing: [] });
  });

  it.each(['with singular fallbacks', 'without singular fallbacks'])(
    'uses the first configured API and RPC from the plural lists %s',
    (mode) => {
      if (mode === 'without singular fallbacks') {
        delete process.env.NEXT_PUBLIC_API_URL;
        delete process.env.NEXT_PUBLIC_RPC_URL;
      }
      process.env.NEXT_PUBLIC_API_URLS = ' , https://a.example/api/cosmicgame/, https://b.example';
      process.env.NEXT_PUBLIC_RPC_URLS = ' , https://a.example/rpc, https://b.example/rpc';

      expect(getEnvValidation()).toEqual({ valid: true, missing: [] });
      jest.isolateModules(() => {
        const { networkConfig: configured } =
          jest.requireActual<typeof import('../networks')>('../networks');
        expect(configured.apiUrl).toBe('https://a.example/api/cosmicgame/');
        expect(configured.rpcUrl).toBe('https://a.example/rpc');
      });
    },
  );

  it('rejects a missing WalletConnect project id', () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = '';

    expect(getEnvValidation()).toEqual({
      valid: false,
      missing: ['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'],
    });
  });

  it('trims the WalletConnect project id before validating it', () => {
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = '   ';

    expect(getEnvValidation().missing).toContain('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID');
  });

  it('reports all required missing values at once', () => {
    process.env.NEXT_PUBLIC_NETWORK = '';
    process.env.NEXT_PUBLIC_API_URL = '';
    process.env.NEXT_PUBLIC_RPC_URL = '';
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = '';

    expect(getEnvValidation()).toEqual({
      valid: false,
      missing: [
        'NEXT_PUBLIC_NETWORK',
        'NEXT_PUBLIC_API_URL (or NEXT_PUBLIC_API_URLS)',
        'NEXT_PUBLIC_RPC_URL (or NEXT_PUBLIC_RPC_URLS)',
        'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
      ],
    });
  });

  it('preserves the existing invalid-network message while validating wallet config', () => {
    process.env.NEXT_PUBLIC_NETWORK = 'ethereum';

    expect(getEnvValidation()).toEqual({
      valid: false,
      missing: ['NEXT_PUBLIC_NETWORK (must be: local, sepolia, or mainnet)'],
    });
  });
});

describe('browser RPC routing', () => {
  const configured = networkConfig.rpcUrl;
  afterEach(() => {
    networkConfig.rpcUrl = configured;
  });

  it.each([
    'https://ARBITRUM-MAINNET.infura.io/v3/demo',
    'https://arb-mainnet.g.alchemy.com/v2/demo',
  ])('uses the configured HTTPS provider endpoint %s', (rpc) => {
    networkConfig.rpcUrl = rpc;
    expect(getPublicClientRpcUrl()).toBe(rpc);
  });

  it.each([
    'https://rpc.example.test/infura.io',
    'https://rpc.example.test/?name=alchemy.com',
    'https://infura.io.example.test/',
    'http://arb-mainnet.g.alchemy.com',
    'unconfigured host',
  ])('proxies the custom endpoint %s', (rpc) => {
    networkConfig.rpcUrl = rpc;
    expect(getPublicClientRpcUrl()).toBe(`${window.location.origin}/api/rpc`);
  });
});
