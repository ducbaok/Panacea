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
}

import { createPaginatedType } from '../../common/pagination';

@ObjectType()
export class PaginatedUsers extends createPaginatedType(User) {}

