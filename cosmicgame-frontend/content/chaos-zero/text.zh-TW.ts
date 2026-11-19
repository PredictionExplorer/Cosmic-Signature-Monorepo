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
  '每個演繹週期，Chaos Zero 都會開放八個預測市場。其中一題是本週期收官時的落筆次數是否會超過上一週期。所有預測憑證皆以 CST 計價。',
  '交易持續至 Cosmic Signature 收官。之後，八個問題的答案由鏈上週期資料決定。同一週期、同一題的一對 YES 和 NO 代幣可以換回一單位 CST。',
  ...(isV4Mechanics
    ? [
        `在 V4 中，主合約為每個新週期銘刻 ${formatCount(chaosZeroGrantCst, 'zh-TW')} CST 並轉入 Chaos Zero，八個問題各分得 ${formatCount(chaosZeroCstPerQuestion, 'zh-TW')} CST。只有主合約能提供新增流動性。主合約不收取費用、不取得份額，投入的 CST 也不會退還。`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? `V4 另為藝術品合約銘刻 ${v4ArtNftsPerCycle} 枚 NFT，並將 ${formatCount(chaosZeroGrantCst, 'zh-TW')} CST 轉入 Chaos Zero，供下一週期使用。所有分配軌道都生效時，共銘刻 ${v4TypicalNftsPerCycle} 枚 NFT 與 ${formatCount(v4TypicalFixedCstPerCycle, 'zh-TW')} CST，參與 CST 另計。這八件新增作品分別在 Axiom Zero 上出售。`
  : '';
