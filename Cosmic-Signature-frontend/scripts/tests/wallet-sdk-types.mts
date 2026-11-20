import { CreatePolicyBodySchema, type CreatePolicyBody } from '@coinbase/cdp-sdk';
import { W3mFrameSchema, type W3mFrameTypes } from '@reown/appkit-wallet';
import type { z } from 'zod/v4';

// Compile this file against the declarations shipped beside the real SDK copy.
W3mFrameSchema.appEvent satisfies z.ZodType;
CreatePolicyBodySchema satisfies z.ZodType;
const event: W3mFrameTypes.FrameEvent = W3mFrameSchema.frameEvent.parse({});
event.type satisfies string;
const policy: CreatePolicyBody = CreatePolicyBodySchema.parse({});
policy.scope satisfies 'project' | 'account';

// @ts-expect-error A consumer can only publish known protocol messages.
const invalidEvent: W3mFrameTypes.FrameEvent = { type: '@not-a-frame-message' };
// @ts-expect-error A consumer can only select a supported scope.
const invalidScope: CreatePolicyBody['scope'] = 'other';

type Rule = Extract<CreatePolicyBody['rules'][number], { operation: 'sendEvmTransaction' }>;
type Criterion = NonNullable<Rule['criteria']>[number];
type ABI = Extract<Criterion, { type: 'evmData' }>['abi'];
type Addresses = Extract<Criterion, { type: 'evmAddress' }>['addresses'];
const abi: ABI = [
  { type: 'function', name: 'transfer', inputs: [], outputs: [], stateMutability: 'nonpayable' },
];
// @ts-expect-error A custom ABI entry has a typed Solidity discriminant.
const invalidAbi: ABI = [{ type: 'other' }];
// @ts-expect-error Wallet addresses have a hex prefix.
const invalidAddresses: Addresses = ['invalid'];
