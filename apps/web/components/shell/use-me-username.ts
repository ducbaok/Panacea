'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@apollo/client/react';
import { MeDocument, type MeQuery } from '@/lib/gql/graphql';

/**
 * Username THẬT của người đang đăng nhập, cho link "Hồ sơ của tôi" ở shell.
 *
 * ⚠️ TRƯỚC FE-6 shell suy username từ `email.split('@')[0]` — SAI khi username
 * khác phần đầu email (bao@example.com nhưng username `bao_developer`) ⇒ link
 * hồ sơ 404. Nay hồ sơ /@username đã tồn tại nên phải đọc username thật từ `me`.
 *
 * `skip` khi chưa đăng nhập ⇒ khách KHÔNG bắn query (đúng khuôn use-unread-count).
 * Trả `null` khi đang tải; call-site fallback về '/' để không link vào route hỏng.
 */
export function useMeUsername(): string | null {
  const { status } = useSession();
  const { data } = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });
  return data?.me?.username ?? null;
}
