'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import {
  UserByUsernameDocument,
  type UserByUsernameQuery,
  type UserByUsernameQueryVariables,
  FollowDocument,
  UnfollowDocument,
} from '@/lib/gql/graphql';
import { useFollowers, useFollowing } from '@/lib/hooks/usePaginatedQuery';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';
import { boardErrorKey } from '@/lib/errors/board-error';
import { useT } from '@/lib/i18n/provider';

/**
 * C3 — Follower / Following (FE-10, view=follows).
 *
 * MỘT component, HAI route: `/@handle/followers` và `/@handle/following` (QĐ-C).
 * Tab đang mở suy từ prop `tab` — tức là từ URL segment, KHÔNG từ state cục bộ:
 * bấm tab là `router.push` sang route kia. Vì thế F5/back/forward/chia sẻ link
 * đều giữ đúng tab, và chữ rỗng ("Chưa có ai theo dõi" vs "Chưa theo dõi ai")
 * không bao giờ lệch khỏi URL.
 *
 * Auth TUỲ CHỌN (cố ý KHÔNG có trong proxy.ts matcher): khách xem được danh
 * sách; chỉ khi bấm nút Theo dõi mới bị AuthPrompt chặn.
 *
 * 🔴 BẪY 1 (field viewer-aware im lặng) — `isFollowedByViewer` trả `false` cho
 * MỌI dòng khi thiếu token, không hề báo lỗi, và màn trông "hợp lý": ai cũng
 * hiện nút "Theo dõi". Phép T2.1 canh đúng chỗ này: đăng nhập rồi mở một danh
 * sách có CẢ hai loại, phải thấy đồng thời ≥1 "Đang theo dõi" và ≥1 "Theo dõi".
 *
 * 🔴 §4.1 — bản vẽ ghi `data-op="followUser"`, mutation đó KHÔNG tồn tại. Thật
 * là HAI mutation `follow`/`unfollow`, chọn theo `isFollowedByViewer`. Gọi
 * `follow` khi đã follow ⇒ backend ném "Already following this user".
 *
 * Số ở nhãn tab lấy từ `userByUsername` (followerCount/followingCount) qua
 * formatCount (QĐ-10) — KHÔNG chép số giả "128.4K"/"2.031" của bản vẽ, và
 * KHÔNG đếm độ dài mảng đã tải (mới có 20 dòng đầu).
 */

export type FollowsTab = 'followers' | 'following';

export function FollowsView({ username, tab }: { username: string; tab: FollowsTab }) {
  const t = useT();
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const toast = useToast();

  const userQuery = useQuery<UserByUsernameQuery, UserByUsernameQueryVariables>(
    UserByUsernameDocument,
    { variables: { username } },
  );
  const user = userQuery.data?.userByUsername;

  // Hai hook cùng gắn, hook của tab ĐANG ĐÓNG bị `skip` ⇒ không tốn request. Cách
  // này giữ số lượng hook cố định giữa các lần render (luật hook của React) mà
  // vẫn chỉ nạp một danh sách.
  const followers = useFollowers(
    { userId: user?.id ?? '', first: 20 },
    { skip: !user?.id || tab !== 'followers' },
  );
  const following = useFollowing(
    { userId: user?.id ?? '', first: 20 },
    { skip: !user?.id || tab !== 'following' },
  );
  const list = tab === 'followers' ? followers : following;

  /*
   * ─── DEBT-1b b5 (17/08/2026) — ghi thẳng Apollo cache, bỏ ghi đè cục bộ ───
   *
   * 🔴 **Đính chính tiền đề của brief.** `PROMPT_DEBT1.md` §2b.5 mô tả món này là
   * *"gọi `userQuery.refetch()` + `list.refetch()` ⇒ 3 request/lần bấm"* và trỏ
   * `follows-view.tsx:204-205`. **Đo lại 17/08: KHÔNG đúng.** Hai dòng đó là nút
   * *"Thử lại"* của thẻ lỗi mạng — refetch cả hai ở đó là **đúng**. Nút Theo dõi
   * chưa bao giờ refetch; FE-10 đã dùng `followOverride` cục bộ. Số đo trên trình
   * duyệt **trước** đợt này: bấm Theo dõi ⇒ **đúng 1 operation** (`Follow`).
   * ⇒ *Mẫu "follow rồi refetch" thật sự nằm ở `pin-detail.tsx` và
   * `profile-view.tsx`, không nằm ở màn này* — đã đăng ký lại cho đúng chỗ.
   *
   * **Vậy đổi để được gì, nếu số request không giảm:** `followOverride` là một
   * nguồn sự thật **thứ hai, chỉ sống trong màn này**. Theo dõi ai đó ở C3 rồi
   * mở hồ sơ của họ ⇒ nút bên đó vẫn hiện "Theo dõi", vì cache chưa hề biết.
   * `cache.modify` theo `cache.identify({ __typename: 'User', id })` sửa đúng
   * thực thể đó, nên **mọi màn đang mở cùng user đều đúng** — khuôn `unsavePin`
   * của `pin-detail.tsx` với `isSavedByViewer`.
   *
   * **Lý do cũ ("field viewer-aware, ghi cache là nguy hiểm") KHÔNG còn đứng
   * vững, và kiểm được:** `lib/apollo/provider.tsx:188` gọi `client.resetStore()`
   * mỗi khi danh tính đổi (khách→đăng nhập, đăng nhập→khách, đổi token). Trong
   * một lần nạp cache chỉ có **đúng một** viewer, nên `isFollowedByViewer` trong
   * cache không thể mang nghĩa của người khác. Nếu ngày nào đó bỏ `resetStore`
   * thì phải xét lại chỗ này — đó là điều kiện, không phải giả định.
   */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [followM] = useMutation(FollowDocument);
  const [unfollowM] = useMutation(UnfollowDocument);
  const apollo = useApolloClient();

  /** Ghi `isFollowedByViewer` của ĐÚNG một User vào cache. Xem khối lý do ở trên. */
  const writeFollowed = (userId: string, value: boolean) => {
    apollo.cache.modify({
      id: apollo.cache.identify({ __typename: 'User', id: userId }),
      fields: { isFollowedByViewer: () => value },
    });
  };

  const rows = list.items;

  async function onToggleFollow(row: (typeof rows)[number]) {
    if (sessionStatus !== 'authenticated') {
      openAuthPrompt('auth.actionFollow');
      return;
    }
    if (busyIds.has(row.id)) return;

    const currently = row.isFollowedByViewer ?? false;
    const next = !currently;
    // Ghi cache NGAY, trước khi mạng trả lời: đây là phần "optimistic" của thao
    // tác. Thất bại thì viết ngược lại ở `catch` — cùng một cơ chế cho cả hai
    // chiều, nên không có trạng thái nào chỉ tồn tại ở một nửa đường đi.
    writeFollowed(row.id, next);
    setBusyIds((s) => new Set(s).add(row.id));
    try {
      // Chọn mutation theo trạng thái ĐANG đọc được, không phải theo nút hiển thị.
      if (next) {
        await followM({ variables: { userId: row.id } });
      } else {
        await unfollowM({ variables: { userId: row.id } });
      }
    } catch (err) {
      writeFollowed(row.id, currently);
      const raw = err instanceof Error ? err.message : '';
      const key = boardErrorKey(raw);
      toast({ message: t(key ?? 'profile.followToggleFailed') });
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(row.id);
        return n;
      });
    }
  }

  // ── Trạng thái màn (4 trạng thái bản vẽ: list · loading · empty · neterr) ──
  const heading = user?.name || user?.username || `@${username}`;
  const userMissing = !userQuery.loading && !userQuery.error && !user;
  const emptyText = tab === 'followers' ? t('profile.emptyFollowers') : t('profile.emptyFollowing');
  const netErr = !!userQuery.error || !!list.error;
  const firstLoading = (userQuery.loading && !user) || (list.loading && rows.length === 0);
  const stateName = userMissing
    ? 'notfound'
    : netErr
      ? 'neterr'
      : firstLoading
        ? 'loading'
        : rows.length === 0
          ? 'empty'
          : 'list';

  /**
   * Username không tồn tại ⇒ "không tìm thấy người dùng", KHÔNG phải danh sách
   * rỗng. Bản vẽ không có trạng thái này (nó giả định vào màn từ hồ sơ có thật),
   * nhưng URL gõ tay được: `/@khongton-tai/followers` mà hiện "Chưa có ai theo
   * dõi" là nói dối — người dùng sẽ tin là tài khoản đó có thật mà chưa ai theo
   * dõi. Chữ + cấu trúc mượn nguyên của C1 (profile-view) cho khớp.
   */
  if (userMissing) {
    return (
      <div style={{ padding: '24px 16px 40px' }} data-screen="C3" data-state={`${tab}-notfound`}>
        <StateCard>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-foreground)' }}>
            {t('profile.notFound')}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
            {t('profile.notFoundBody', { username })}
          </div>
        </StateCard>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 16px 40px' }} data-screen="C3" data-state={`${tab}-${stateName}`}>
      <button
        type="button"
        onClick={() => router.push(`/@${username}`)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, color: 'var(--color-muted)', fontWeight: 600, padding: 0, marginBottom: 14 }}
      >
        ← {t('profile.backToProfile')}
      </button>

      <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 24, margin: '0 0 14px', color: 'var(--color-foreground)' }}>
        {heading}
      </h1>

      {/* Tab = điều hướng route, không phải state cục bộ. */}
      <div
        role="tablist"
        aria-label={t('profile.followTabsAria')}
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--color-surface-muted)',
          borderRadius: 999,
          padding: 4,
          width: 'fit-content',
          marginBottom: 20,
        }}
      >
        <TabButton
          active={tab === 'followers'}
          onClick={() => router.push(`/@${username}/followers`)}
          label={t('profile.followerCount', {
            count: user?.followerCount ?? 0,
            countText: formatCount(user?.followerCount),
          })}
        />
        <TabButton
          active={tab === 'following'}
          onClick={() => router.push(`/@${username}/following`)}
          label={t('profile.followingCount', {
            countText: formatCount(user?.followingCount),
          })}
        />
      </div>

      {netErr ? (
        <StateCard>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-foreground)' }}>
            {t('profile.listLoadFailed')}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
            {t('common.checkNetwork')}
          </div>
          <button
            type="button"
            onClick={() => {
              void userQuery.refetch();
              void list.refetch();
            }}
            style={{
              marginTop: 16,
              padding: '10px 20px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-primary-foreground)',
              fontWeight: 700,
              fontSize: 13.5,
              cursor: 'pointer',
            }}
          >
            {t('common.retry')}
          </button>
        </StateCard>
      ) : firstLoading ? (
        <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 14 }}>
          {t('common.loading')}
        </div>
      ) : rows.length === 0 ? (
        <StateCard>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-foreground)' }}>{emptyText}</div>
        </StateCard>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 640 }}>
            {rows.map((u) => {
              // Đọc thẳng từ dữ liệu query — Apollo đã chuẩn hoá theo `User:id`
              // nên `cache.modify` ở `writeFollowed` hiện ra ngay tại đây, không
              // còn lớp ghi đè cục bộ nào chen giữa.
              const isFollowed = u.isFollowedByViewer ?? false;
              return (
                <div
                  key={u.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderRadius: 14,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <RowAvatar name={u.name ?? u.username} url={u.avatarUrl} />
                  <div style={{ minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={() => router.push(`/@${u.username}`)}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: 14,
                        color: 'var(--color-foreground)',
                        textAlign: 'left',
                      }}
                    >
                      {u.name ?? u.username}
                    </button>
                    <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>@{u.username}</div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    aria-pressed={isFollowed}
                    onClick={() => void onToggleFollow(u)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 999,
                      border: isFollowed ? '1px solid transparent' : '1px solid var(--color-border)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 12.5,
                      background: isFollowed ? 'var(--color-foreground)' : 'var(--color-surface)',
                      color: isFollowed ? 'var(--color-background)' : 'var(--color-foreground)',
                      flex: 'none',
                    }}
                  >
                    {isFollowed ? t('profile.following') : t('profile.follow')}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Tải thêm qua `after`. Nút bấm (không phải IntersectionObserver) giữ
              đúng khuôn C2b/D2 các đợt trước. Trạng thái "2 Đang tải thêm" của bản
              vẽ là dải spinner ở ĐÁY danh sách — dựng nguyên, dùng keyframes
              `pin-grid-spin` đã khai ở globals.css thay vì thêm keyframes mới. */}
          {list.hasNextPage && !list.loadingMore && (
            <div style={{ maxWidth: 640 }}>
              <button
                type="button"
                onClick={() => void list.loadMore()}
                style={{
                  marginTop: 8,
                  width: '100%',
                  padding: 10,
                  borderRadius: 12,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {t('common.loadMore')}
              </button>
            </div>
          )}

          {list.loadingMore && (
            <div
              role="status"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: 22,
                color: 'var(--color-muted)',
                fontSize: 13,
                fontWeight: 600,
                maxWidth: 640,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  border: '2.5px solid var(--color-surface-muted)',
                  borderTopColor: 'var(--color-primary-strong)',
                  animation: 'pin-grid-spin 900ms linear infinite',
                }}
              />
              {t('common.loading')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '9px 20px',
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13.5,
        background: active ? 'var(--color-surface)' : 'transparent',
        color: active ? 'var(--color-foreground)' : 'var(--color-muted)',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
      }}
    >
      {label}
    </button>
  );
}

function StateCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '56px 20px',
        textAlign: 'center',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 20,
        maxWidth: 640,
      }}
    >
      {children}
    </div>
  );
}

function RowAvatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: 'var(--color-primary)',
        color: 'var(--color-primary-foreground)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        flex: 'none',
      }}
    >
      {initial}
    </div>
  );
}
