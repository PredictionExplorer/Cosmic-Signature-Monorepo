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
  '每个演绎周期，Chaos Zero 都会开放八个预测市场。其中一个问题是本周期收官时的落笔次数是否会超过上一周期。所有头寸以 CST 计价。',
  '交易持续至 Cosmic Signature 收官。随后，八个问题的答案由链上周期数据确定。同一周期、同一问题的一对 YES 和 NO 代币可以换回一单位 CST。',
  ...(isV4Mechanics
    ? [
        `在 V4 中，主合约为每个新周期铭刻 ${formatCount(chaosZeroGrantCst, 'zh')} CST 并转入 Chaos Zero，八个问题各分得 ${formatCount(chaosZeroCstPerQuestion, 'zh')} CST。只有主合约可以提供新增流动性。主合约不收取费用，不获得份额，投入的 CST 也不会退还。`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? `V4 还为艺术品合约铭刻 ${v4ArtNftsPerCycle} 枚 NFT，并向 Chaos Zero 转入 ${formatCount(chaosZeroGrantCst, 'zh')} CST，供下一周期使用。所有分配轨道均生效时，共铭刻 ${v4TypicalNftsPerCycle} 枚 NFT 和 ${formatCount(v4TypicalFixedCstPerCycle, 'zh')} CST，参与 CST 另计。这八件新增作品分别在 Axiom Zero 上出售。`
  : '';
