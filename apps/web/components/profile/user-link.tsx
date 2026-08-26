'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Lối vào hồ sơ dùng chung — bọc tên hoặc avatar của một người thành liên kết
 * tới `/@username`.
 *
 * Vì sao là component chứ không phải mỗi chỗ tự viết `<Link href={...}>`: có
 * năm bề mặt cần đúng CÙNG một luật (tên tác giả ở màn pin, avatar tác giả,
 * tên người bình luận, tên người trả lời, token `@nhắc` trong nội dung), và cả
 * năm đều có chung hai cái bẫy dưới đây. Viết tay năm lần là năm cơ hội quên
 * một cái.
 *
 * 🔴 Bẫy 1 — KHÔNG có username thì KHÔNG được ra liên kết. `user.username` là
 * nullable trong schema, và pin của tài khoản đã xoá mềm trả `creator` rỗng.
 * `/@` (rỗng) rơi vào `notFound()` của `app/(main)/[handle]/page.tsx`, tức là
 * mời người dùng bấm vào một 404. Trường hợp đó trả thẳng `children` trong một
 * `<span>` — nhìn y hệt, chỉ không bấm được.
 *
 * 🔴 Bẫy 2 — thẻ pin trên lưới là một `<article onClick>` mở pin. Liên kết nằm
 * TRONG nó, nên nếu không chặn nổi bọt thì một cú bấm chạy cả hai: điều hướng
 * sang hồ sơ RỒI modal pin đè lên. `stopPropagation` ở đây xử lý một lần cho
 * mọi chỗ dùng, kể cả những chỗ hiện chưa nằm trong vùng bấm nào — vô hại khi
 * không có cha nào lắng nghe.
 *
 * Đường dẫn phải mở đầu `@` (QĐ-C): route `[handle]` 404 mọi handle không có
 * `@`, xem docblock của trang hồ sơ.
 */
export function UserLink({
  username,
  children,
  style,
  title,
  testId,
}: {
  username?: string | null;
  children: ReactNode;
  style?: CSSProperties;
  title?: string;
  testId?: string;
}) {
  const uname = username?.trim();
  if (!uname) {
    return (
      <span style={style} data-testid={testId}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={`/@${uname}`}
      title={title}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'inherit', textDecoration: 'none', ...style }}
    >
      {children}
    </Link>
  );
}
