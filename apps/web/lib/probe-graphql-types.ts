/**
 * Probe FE-0 §8 phép 1+2: rào alias `@antigravity/graphql-types` giữa apps/web
 * và packages/graphql-types.
 *
 * Đỏ trước (đã đo 2026-08-12): gỡ dep khỏi apps/web/package.json ⇒ `tsc` báo
 *   TS2307 "Cannot find module '@antigravity/graphql-types'"  ← chứng minh rào có thật
 * Xanh sau: add lại workspace dep ⇒ import + type assertion sau đây type-check sạch.
 *
 * Giữ file làm regression rẻ tiền — nếu ai đó vô tình cấu hình lại tsconfig/paths
 * hoặc xoá dep, `tsc` vỡ ngay ở đây.
 */
import type { Pin, ReactionType } from '@antigravity/graphql-types';

// Union đúng 5 giá trị đã kiểm ở generated/index.ts:606-611 (thứ tự alphabet).
type _ExpectedReactionUnion = 'FUNNY' | 'HEART' | 'IDEA' | 'THANKS' | 'WOW';

// Hai chiều: nếu ReactionType lệch (thêm/bớt giá trị) thì tsc vỡ.
type _AssertReactionEq =
  [ReactionType] extends [_ExpectedReactionUnion]
    ? [_ExpectedReactionUnion] extends [ReactionType]
      ? true
      : never
    : never;

// Nếu viewerReaction đổi hình dạng khỏi `Maybe<ReactionType>` cũng vỡ ở đây.
type _AssertViewerReaction =
  Pin['viewerReaction'] extends ReactionType | null | undefined ? true : never;

export const _probe: _AssertReactionEq & _AssertViewerReaction = true;
