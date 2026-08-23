import { ReactionType } from '@/lib/gql/graphql';
import type { TranslationKey } from '@/lib/i18n/translate';

/**
 * FE-4 §4.1 — Bảng ánh xạ ReactionType → emoji + nhãn.
 *
 * Mockup Panacea `REACTIONS = ["Thích","Yêu","Tuyệt","Hữu ích","Cười"]` KHÔNG
 * ánh xạ được sang enum `ReactionType` theo vị trí: mockup thiếu nhãn cho
 * `THANKS` (cảm ơn) và thừa nhãn "Thích" mà API không có.
 *
 * Bảng dưới đây là quyết định đã chốt trong đợt FE-4 — bỏ "Thích", giữ đúng
 * 5 enum của API. Nguồn duy nhất: nếu nơi khác cần emoji/nhãn cảm xúc thì
 * import từ file này, đừng chép rải rác — chép rải là hình dạng lỗi số 4 của
 * dự án (mock/prod diverge âm thầm).
 */

/**
 * Dùng enum members (không phải string literal) vì codegen sinh `ReactionType`
 * là TypeScript enum thật — literal `'HEART'` không assignable vào type `ReactionType`
 * trực tiếp (khác với `Record<ReactionType, T>` — chỗ đó chấp key theo giá trị).
 */
export const REACTION_ORDER: readonly ReactionType[] = [
  ReactionType.Heart,
  ReactionType.Idea,
  ReactionType.Thanks,
  ReactionType.Wow,
  ReactionType.Funny,
] as const;

export const REACTION_EMOJI: Record<ReactionType, string> = {
  HEART: '❤️',
  IDEA: '💡',
  THANKS: '🙏',
  WOW: '😮',
  FUNNY: '😂',
};

/**
 * i18n (23/08/2026) — bảng nhãn nay giữ KEY từ điển thay vì chữ Việt; nơi dùng
 * gọi `t(REACTION_LABEL_KEY[type])`. Emoji ở trên KHÔNG đổi theo ngôn ngữ.
 */
export const REACTION_LABEL_KEY: Record<ReactionType, TranslationKey> = {
  HEART: 'pin.reactionHeart',
  IDEA: 'pin.reactionIdea',
  THANKS: 'pin.reactionThanks',
  WOW: 'pin.reactionWow',
  FUNNY: 'pin.reactionFunny',
};
