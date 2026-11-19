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
  'У кожному перформанс-циклі Chaos Zero відкриває вісім ринків прогнозів. Одне із запитань — чи завершиться цей цикл із більшою кількістю жестів, ніж попередній? Усі позиції обліковуються в CST.',
  'Торгівля триває до моменту, коли Cosmic Signature завершить цикл. Тоді відповіді на всі вісім запитань визначаються за ончейн-статистикою циклу. Пару токенів YES і NO для одного запитання в тому самому циклі можна обміняти на один CST.',
  ...(isV4Mechanics
    ? [
        `У V4 основний контракт закарбовує ${formatCount(chaosZeroGrantCst, 'uk')} CST для кожного нового циклу й переказує їх до Chaos Zero. Кожне з восьми запитань отримує по ${formatCount(chaosZeroCstPerQuestion, 'uk')} CST. Лише основний контракт надає нову ліквідність. За це йому не нараховують комісій, не видають часток і не повертають коштів.`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? ` V4 також закарбовує ${v4ArtNftsPerCycle} NFT для контракту мистецьких робіт і переказує ${formatCount(chaosZeroGrantCst, 'uk')} CST до Chaos Zero для наступного циклу. За наявності всіх напрямів загалом випускається ${v4TypicalNftsPerCycle} NFT і ${formatCount(v4TypicalFixedCstPerCycle, 'uk')} фіксованих CST. CST участі обліковуються окремо. Кожен із восьми додаткових творів можна придбати окремо на Axiom Zero.`
  : '';
