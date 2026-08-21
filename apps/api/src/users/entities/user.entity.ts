import { ObjectType, Field, ID } from '@nestjs/graphql';

/**
 * User GraphQL entity — đại diện cho model User trong database.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. @ObjectType() class.
 * 2. Fields (tất cả nullable trừ id vì đây là public view, có thể thiếu data):
 *    - id: ID (required)
 *    - name: String (optional) — tên hiển thị
 *    - username: String (optional) — unique identifier
 *    - avatarUrl: String (optional) — URL ảnh đại diện
 *    - bio: String (optional) — giới thiệu ngắn
 *    - email: String (optional) — ⚠ CHỈ hiển thị cho chính user, null cho người khác
 *    - website: String (optional)
 *    - isOnboarded: Boolean (optional) — đã hoàn tất onboarding chưa
 *    - locale: String (optional) — ngôn ngữ ưu tiên
 * 3. KHÔNG expose password (dùng @HideField() nếu cần).
 * 4. **Email privacy**: Resolver layer chịu trách nhiệm set email = null
 *    nếu viewer không phải owner (xem users.resolver.ts).
 *
 * LƯU Ý: Khi Phase 2.0 thêm deletedAt vào User model,
 * KHÔNG expose deletedAt trong GraphQL entity (thông tin nội bộ).
 */
@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  username?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  /**
   * REVIEW-1 (#6) — ảnh bìa hồ sơ. Trước đợt này dải bìa ở trang cá nhân là
   * gradient trang trí cứng, không có đường nào đặt ảnh thật (bản vẽ C1b ghi
   * thẳng "không có ảnh bìa thật"); người dùng yêu cầu đổi được ⇒ thêm cột.
   * Null = FE vẽ lại gradient cũ làm fallback.
   */
  @Field({ nullable: true })
  coverUrl?: string;

  @Field({ nullable: true })
  bio?: string;

  /**
   * Email — chỉ trả về cho chính user đó.
   * Resolver layer sẽ set null nếu viewer !== owner.
   */
  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  website?: string;

  @Field({ nullable: true })
  isOnboarded?: boolean;

  @Field({ nullable: true })
  locale?: string;

  // ─── ResolveFields (Phase 2.1) ─────────────────────────────────────────────
  
  /**
   * Tổng số người đang follow user này.
   * Dùng Dataloader (followerCountLoader) để tránh N+1.
   */
  @Field(() => Number, { nullable: true })
  followerCount?: number;

  /**
   * Tổng số người user này đang follow.
   * Dùng Dataloader (followingCountLoader).
   */
  @Field(() => Number, { nullable: true })
  followingCount?: number;

  /**
   * Viewer hiện tại có đang follow user này không.
   * Dùng Dataloader (isFollowingLoader) kết hợp với CurrentUser ID.
   */
  @Field(() => Boolean, { nullable: true })
  isFollowedByViewer?: boolean;

  /**
   * User này có đang follow viewer hiện tại không (Mutual check).
   * Dùng Dataloader (isFollowedByLoader).
   */
  @Field(() => Boolean, { nullable: true })
  isFollowingViewer?: boolean;

  /**
   * Viewer đã CHẶN user này chưa? — MỘT CHIỀU: blockerId = viewer (QĐ-7 / FE-6).
   *
   * ⚠️ MỘT CHIỀU CÓ CHỦ ĐÍCH, KHÁC `getBlockedUserIds` (hai chiều). Hàm hai
   * chiều trả lời "ai tôi KHÔNG được thấy" (lọc feed, gồm cả người chặn tôi);
   * dùng nó ở đây thì hồ sơ của người CHẶN TÔI cũng hiện nút "Bỏ chặn", bấm vào
   * lại không có row nào để xoá ⇒ nút chết. Field này chỉ hỏi "TÔI có chặn họ
   * không" để C1b đổi nút Chặn ↔ Bỏ chặn. Xem buildIsBlockedByViewerLoader.
   */
  @Field(() => Boolean, { nullable: true })
  isBlockedByViewer?: boolean;
}

import { createPaginatedType } from '../../common/pagination';

@ObjectType()
export class PaginatedUsers extends createPaginatedType(User) {}

