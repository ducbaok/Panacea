import { ReactionType } from '@/lib/gql/graphql';

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

export const REACTION_LABEL: Record<ReactionType, string> = {
  HEART: 'Yêu',
  IDEA: 'Hữu ích',
  THANKS: 'Cảm ơn',
  WOW: 'Tuyệt',
  FUNNY: 'Cười',
};
