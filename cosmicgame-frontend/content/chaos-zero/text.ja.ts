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
  'Chaos Zeroはパフォーマンス・サイクルごとに八つの予測市場を開きます。その一つは「このサイクルは前のサイクルより多い筆数で確定するか？」という問いです。すべてのポジションはCST建てです。',
  '取引はCosmic Signatureがサイクルを確定するまで続きます。その時点でオンチェーンのサイクル統計から八つの答えが決まります。同じサイクルの同じ問いのYESとNOを一つずつ組み合わせると、1CSTに交換できます。',
  ...(isV4Mechanics
    ? [
        `V4ではメインコントラクトが新しいサイクルごとに${formatCount(chaosZeroGrantCst, 'ja')}CSTを刻印し、Chaos Zeroに送ります。八つの問いにそれぞれ${formatCount(chaosZeroCstPerQuestion, 'ja')}CSTが配分されます。新たな流動性を提供できるのはメインコントラクトだけです。手数料や持分を受け取ることも、提供したCSTが返還されることもありません。`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? `V4では作品用のコントラクトにNFTをさらに${v4ArtNftsPerCycle}点刻印し、次のサイクルのためにChaos Zeroへ${formatCount(chaosZeroGrantCst, 'ja')}CSTを送ります。すべての配分トラックが適用される場合、合計でNFT${v4TypicalNftsPerCycle}点と固定額の${formatCount(v4TypicalFixedCstPerCycle, 'ja')}CSTが刻印されます。参加CSTは別に計算します。追加の八つの作品はAxiom Zeroで一点ずつ販売されます。`
  : '';
