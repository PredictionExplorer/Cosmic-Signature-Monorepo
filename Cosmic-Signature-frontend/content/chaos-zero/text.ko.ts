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
  'Chaos Zero는 퍼포먼스 사이클마다 예측 시장 8개를 엽니다. 그중 한 질문은 “이번 사이클은 이전 사이클보다 더 많은 제스처로 마감될 것인가?”입니다. 모든 포지션은 CST로 표시됩니다.',
  '거래는 Cosmic Signature가 사이클을 마감할 때까지 이어집니다. 마감 시점의 온체인 사이클 통계로 질문 8개의 답이 결정됩니다. 같은 사이클의 같은 질문에서 YES와 NO 토큰을 1개씩 짝지으면 1 CST로 교환할 수 있습니다.',
  ...(isV4Mechanics
    ? [
        `V4에서는 메인 컨트랙트가 새 사이클마다 ${formatCount(chaosZeroGrantCst, 'ko')} CST를 각인해 Chaos Zero로 보냅니다. 질문 8개에 각각 ${formatCount(chaosZeroCstPerQuestion, 'ko')} CST가 배분됩니다. 새 유동성은 메인 컨트랙트만 공급할 수 있습니다. 컨트랙트는 수수료나 지분을 받지 않으며 공급한 CST도 돌려받지 않습니다.`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? ` V4에서는 작품 컨트랙트용 NFT ${v4ArtNftsPerCycle}개를 추가로 각인하고 다음 사이클을 위해 Chaos Zero로 ${formatCount(chaosZeroGrantCst, 'ko')} CST를 보냅니다. 모든 배분 경로가 활성화되면 총 NFT ${v4TypicalNftsPerCycle}개와 고정 수량 ${formatCount(v4TypicalFixedCstPerCycle, 'ko')} CST를 각인합니다. 참여 CST는 별도입니다. 추가 작품 8점은 Axiom Zero에서 각각 판매합니다.`
  : '';
