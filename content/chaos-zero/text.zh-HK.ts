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
  '每個演繹週期，Chaos Zero 都會開放八個預測市場。其中一題是本週期收官時的落筆次數會否超過上一週期。所有預測憑證均以 CST 計價。',
  '交易持續至 Cosmic Signature 收官。其後，八個問題的答案由鏈上週期數據決定。同一週期、同一題的一對 YES 和 NO 代幣可以換回一單位 CST。',
  ...(isV4Mechanics
    ? [
        `在 V4 中，主合約為每個新週期銘刻 ${formatCount(chaosZeroGrantCst, 'zh-HK')} CST 並轉入 Chaos Zero，八個問題各分得 ${formatCount(chaosZeroCstPerQuestion, 'zh-HK')} CST。只有主合約可提供新增流動性。主合約不收取費用、不獲分配份額，投入的 CST 亦不會退還。`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? `V4 另為藝術品合約銘刻 ${v4ArtNftsPerCycle} 枚 NFT，並將 ${formatCount(chaosZeroGrantCst, 'zh-HK')} CST 轉入 Chaos Zero，供下一週期使用。所有分配軌道均生效時，合共銘刻 ${v4TypicalNftsPerCycle} 枚 NFT 及 ${formatCount(v4TypicalFixedCstPerCycle, 'zh-HK')} CST，參與 CST 另計。這八件新增作品會在 Axiom Zero 逐件發售。`
  : '';
