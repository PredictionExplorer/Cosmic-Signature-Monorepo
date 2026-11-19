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
  'Chaos Zero mở tám thị trường dự đoán trong mỗi chu kỳ trình diễn. Một trong tám câu hỏi là “Chu kỳ này có hoàn tất với nhiều nét bút hơn chu kỳ trước không?” Các vị thế được tính bằng CST.',
  'Giao dịch tiếp tục cho đến khi Cosmic Signature hoàn tất chu kỳ. Khi đó, kết quả của cả tám câu hỏi được xác định từ số liệu của chu kỳ trên chuỗi. Một cặp token YES và NO của cùng câu hỏi trong cùng chu kỳ có thể đổi lại một CST.',
  ...(isV4Mechanics
    ? [
        `Trong V4, hợp đồng chính khắc ${formatCount(chaosZeroGrantCst, 'vi')} CST cho mỗi chu kỳ mới và chuyển số CST đó đến Chaos Zero. Mỗi câu hỏi trong số tám câu nhận ${formatCount(chaosZeroCstPerQuestion, 'vi')} CST. Chỉ hợp đồng chính được cung cấp thanh khoản mới. Hợp đồng không nhận phí, phần sở hữu hay khoản hoàn trả nào.`,
      ]
    : []),
];

export const v4CycleIssuanceNote = isV4Mechanics
  ? ` V4 cũng khắc ${v4ArtNftsPerCycle} NFT cho hợp đồng tác phẩm và chuyển ${formatCount(chaosZeroGrantCst, 'vi')} CST đến Chaos Zero cho chu kỳ tiếp theo. Khi có đủ các luồng phân bổ, tổng số được khắc là ${v4TypicalNftsPerCycle} NFT và ${formatCount(v4TypicalFixedCstPerCycle, 'vi')} CST cố định. CST tham gia được tính riêng. Tám tác phẩm mới được bán riêng lẻ trên Axiom Zero.`
  : '';
