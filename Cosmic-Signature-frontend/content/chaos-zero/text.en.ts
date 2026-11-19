import {
  chaosZeroGrantCst,
  chaosZeroCstPerQuestion,
  isV4Mechanics,
  v4ArtNftsPerCycle,
  v4TypicalNftsPerCycle,
  v4TypicalFixedCstPerCycle,
} from '@/content/protocol-facts';

import { formatCount } from '@/utils/format/numbers';

export const chaosZeroParagraphs = [
  'Chaos Zero opens eight prediction markets every Performance Cycle. One asks whether this cycle will finalize with more gestures than the previous one. Positions are denominated in CST.',
  'Trading stays open until Cosmic Signature finalizes the cycle. All eight answers then follow from the on-chain cycle statistics. A matching YES and NO pair for the same question can be exchanged for one CST.',
  ...(isV4Mechanics
    ? [
        `In V4 the main contract issues ${formatCount(chaosZeroGrantCst, 'en')} CST for each new cycle and sends it to Chaos Zero. Each of the eight questions receives ${formatCount(chaosZeroCstPerQuestion, 'en')} CST. Only the main contract supplies new liquidity. It receives no fees, shares or repayments.`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? ` V4 also creates ${v4ArtNftsPerCycle} NFTs for the art contract and sends ${formatCount(chaosZeroGrantCst, 'en')} CST to Chaos Zero for the next cycle. With all allocation tracks present, total issuance is ${v4TypicalNftsPerCycle} NFTs and ${formatCount(v4TypicalFixedCstPerCycle, 'en')} fixed CST, plus any Participation CST. The eight additional artworks are offered individually on Axiom Zero.`
  : '';
