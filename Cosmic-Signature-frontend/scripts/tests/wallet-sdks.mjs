import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';
import { z } from 'zod/v4';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { packages } = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
function installedCopies(name) {
  return Object.keys(packages)
    .filter((location) => location.endsWith(`node_modules/${name}`))
    .map((location) => resolve(root, location));
}

const wagmi = createRequire(createRequire(import.meta.url).resolve('wagmi'));
const connectors = createRequire(wagmi.resolve('@wagmi/connectors'));
const provider = createRequire(connectors.resolve('@walletconnect/ethereum-provider'));
const appKit = createRequire(provider.resolve('@reown/appkit'));
const base = createRequire(connectors.resolve('@base-org/account'));
const frameEntry = appKit.resolve('@reown/appkit-wallet');
const { W3mFrameSchema: frame } = await import(pathToFileURL(frameEntry));
const frameRoot = installedCopies('@reown/appkit-wallet').find((directory) =>
  frameEntry.startsWith(directory + sep),
);
assert.ok(frameRoot, 'Reown frame loaded by WalletConnect must be in the lockfile');

test('Reown accepts optional RPC parameters and successful void replies', () => {
  assert.ok(frame.appEvent instanceof z.ZodType);
  assert.ok(frame.frameEvent instanceof z.ZodType);
  for (const method of ['wallet_getAssets', 'wallet_revokePermissions']) {
    const message = { type: '@w3m-app/RPC_REQUEST', payload: { method } };
    assert.deepEqual(frame.appEvent.parse(message), message);
  }
  const reply = { type: '@w3m-frame/RPC_REQUEST_SUCCESS', id: 'request-1' };
  assert.deepEqual(frame.frameEvent.parse(reply), reply);
});

test('Reown validates each wallet theme value and returns structured errors', () => {
  const theme = {
    themeMode: 'dark',
    themeVariables: { '--spacing': 4 },
    w3mThemeVariables: { '--font': 'sans-serif' },
  };
  const event = { type: '@w3m-app/SYNC_THEME', payload: theme };
  assert.deepEqual(frame.appEvent.parse(event), event);
  const bad = frame.appEvent.safeParse({
    ...event,
    payload: { ...theme, w3mThemeVariables: { '--font': false } },
  });
  assert.equal(bad.success, false);
  assert.ok(bad.error.issues.length > 0);
});

const cdpCopies = installedCopies('@coinbase/cdp-sdk');
const baseEntry = base.resolve('@coinbase/cdp-sdk');
assert.ok(
  cdpCopies.some((directory) => baseEntry.startsWith(directory + sep)),
  'CDP loaded by the Base Account connector must be in the lockfile',
);

// npm can place separate CDP copies beneath wagmi's Base Account and Reown's
// utilities. Exercise both public module formats of each installed copy.
for (const directory of cdpCopies) {
  const { exports } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const label = relative(root, directory);
  for (const format of ['import', 'default']) {
    test(`${label} (${format}) validates typed data and transaction ABI policies`, async () => {
      const entry = resolve(directory, exports['.'][format]);
      const sdk = format === 'import' ? await import(pathToFileURL(entry)) : base(entry);
      assert.ok(sdk.CreatePolicyBodySchema instanceof z.ZodType);
      assert.ok(sdk.UpdatePolicyBodySchema instanceof z.ZodType);
      const typedData = {
        type: 'evmTypedDataField',
        types: { types: { Order: [{ name: 'asset', type: 'bytes32' }] }, primaryType: 'Order' },
        conditions: [{ path: 'asset', match: 'ETH' }],
      };
      const abi = {
        type: 'evmData',
        abi: [
          {
            type: 'function',
            name: 'transfer',
            stateMutability: 'nonpayable',
            inputs: [{ name: 'amount', type: 'uint256' }],
            outputs: [],
          },
        ],
        conditions: [{ function: 'transfer' }],
      };
      const policy = {
        scope: 'account',
        rules: [
          { operation: 'signEvmTypedData', action: 'accept', criteria: [typedData] },
          { operation: 'sendEvmTransaction', action: 'accept', criteria: [abi] },
        ],
      };
      assert.deepEqual(sdk.CreatePolicyBodySchema.parse(policy), policy);
      assert.deepEqual(sdk.UpdatePolicyBodySchema.parse({ rules: policy.rules }), {
        rules: policy.rules,
      });
      const malformedFields = structuredClone(policy);
      delete malformedFields.rules[0].criteria[0].types.types.Order[0].type;
      assert.equal(sdk.CreatePolicyBodySchema.safeParse(malformedFields).success, false);
      const malformedAbi = structuredClone(policy);
      malformedAbi.rules[1].criteria[0].abi[0].inputs[0].type = 'unknown-type';
      assert.equal(sdk.CreatePolicyBodySchema.safeParse(malformedAbi).success, false);
    });
  }

  test(`${label} and Reown expose typed Zod 4 schemas to wallet consumers`, () => {
    const fixture = fileURLToPath(new URL('./wallet-sdk-types.mts', import.meta.url));
    const program = ts.createProgram([fixture], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { '@coinbase/cdp-sdk': [directory], '@reown/appkit-wallet': [frameRoot] },
    });
    const messages = ts
      .getPreEmitDiagnostics(program)
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'));
    assert.deepEqual(messages, []);
  });
}
