import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

/** Header mang định danh khách vãng lai. Client (Apollo link) tự sinh + tự giữ. */
export const ANON_ID_HEADER = 'x-anon-id';

/**
 * Trần độ dài `anonId` được chấp nhận.
 *
 * Không phải để chống gian lận — client tự sinh giá trị này nên nó **luôn**
 * giả mạo được (xem ghi chú giới hạn ở `PinsService.trackPinView`). Trần này
 * chỉ để một client hỏng/ác ý không bơm được khoá dài vô hạn vào Redis.
 */
export const ANON_ID_MAX_LENGTH = 64;

/**
 * Decorator đọc `anonId` của khách vãng lai từ header (B-4).
 *
 * VÌ SAO LÀ HEADER CHỨ KHÔNG PHẢI IP — quyết định của user 16/08/2026: sau
 * ALB mọi request dùng chung một IP cho tới khi HT-3 vá `trust proxy`, nên IP
 * sẽ gộp toàn bộ khách vãng lai thành **một** người xem. Cookie/header do
 * client giữ là thứ duy nhất phân biệt được họ ở kiến trúc hiện tại.
 *
 * VÌ SAO KHÔNG ĐỌC THẲNG COOKIE Ở SERVER: API không có cookie-parser và cookie
 * không tự đi kèm request GraphQL cross-origin nếu thiếu cấu hình credentials.
 * Client giữ giá trị trong cookie/localStorage rồi **gửi lên bằng header** —
 * một đường duy nhất, không phụ thuộc cấu hình CORS.
 *
 * Trả `null` khi thiếu, rỗng, hoặc quá dài. `null` ⇒ **không đếm** (xem
 * `PinsService`), chứ không phải "đếm mà không debounce".
 */
export const AnonId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null => {
    const ctx = GqlExecutionContext.create(context);
    const raw: unknown = ctx.getContext()?.req?.headers?.[ANON_ID_HEADER];
    // Header trùng tên nhiều lần ⇒ Node cho ra mảng. Lấy phần tử đầu.
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > ANON_ID_MAX_LENGTH) return null;
    return trimmed;
  },
);
