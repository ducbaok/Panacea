'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation } from '@apollo/client/react';
import {
  UserByUsernameDocument,
  type UserByUsernameQuery,
  MeDocument,
  type MeQuery,
  FollowDocument,
  UnfollowDocument,
  BlockUserDocument,
  UnblockUserDocument,
  CreateConversationDocument,
} from '@/lib/gql/graphql';
import { translateMessagingError } from '@/components/messages/chat-panel';
import { useUserPins, useUserBoards } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { formatCount } from '@/lib/format';

/**
 * C1 — Hồ sơ (FE-6). Hai biến thể của CÙNG một màn:
 *   • C1a `isSelf` — hồ sơ của tôi (Sửa hồ sơ + Tin nhắn).
 *   • C1b `!isSelf` — hồ sơ người khác, 7 trạng thái theo isFollowedByViewer /
 *     isFollowingViewer / isBlockedByViewer.
 *
 * Phân biệt mình/người khác bằng `id` (so me.id), KHÔNG so username — username
 * đổi được (PLAN_FRONTEND §5). Chữ chép NGUYÊN VĂN từ Panacea-v2.html (§9).
 */

type ProfileUser = NonNullable<UserByUsernameQuery['userByUsername']>;

export function ProfileView({ username }: { username: string }) {
  const { status } = useSession();
  const profileQuery = useQuery<UserByUsernameQuery>(UserByUsernameDocument, {
    variables: { username },
  });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });

  if (profileQuery.loading) return <CenteredCard>Đang tải hồ sơ…</CenteredCard>;

  if (profileQuery.error) {
    return (
      <CenteredCard>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Không tải được hồ sơ</div>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
          Kiểm tra mạng rồi thử lại.
        </div>
        <PrimaryButton onClick={() => profileQuery.refetch()} style={{ marginTop: 16 }}>
          Thử lại
        </PrimaryButton>
      </CenteredCard>
    );
  }

  const profile = profileQuery.data?.userByUsername;
  if (!profile) {
    return (
      <CenteredCard>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Không tìm thấy người dùng</div>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
          @{username} không tồn tại hoặc đã đổi tên.
        </div>
      </CenteredCard>
    );
  }

  const isSelf = status === 'authenticated' && meQuery.data?.me?.id === profile.id;
  return (
    <ProfileContent
      key={profile.id}
      profile={profile}
      isSelf={!!isSelf}
      refetchProfile={() => profileQuery.refetch()}
    />
  );
}

function ProfileContent({
  profile,
  isSelf,
  refetchProfile,
}: {
  profile: ProfileUser;
  isSelf: boolean;
  refetchProfile: () => Promise<unknown>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { status } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const [tab, setTab] = useState<'pin' | 'board'>('pin');
  const [hoverFollow, setHoverFollow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [followM] = useMutation(FollowDocument);
  const [unfollowM] = useMutation(UnfollowDocument);
  const [blockM] = useMutation(BlockUserDocument);
  const [unblockM] = useMutation(UnblockUserDocument);
  const [createConversationM] = useMutation(CreateConversationDocument);

  const isBlocked = !!profile.isBlockedByViewer;
  const iFollow = !!profile.isFollowedByViewer;
  const followsMe = !!profile.isFollowingViewer;
  const mutual = iFollow && followsMe;
  const uname = profile.username ?? '';
  const dispName = profile.name ?? uname;

  const pinsTab = useUserPins({ userId: profile.id }, { skip: tab !== 'pin' || isBlocked });
  const boardsTab = useUserBoards({ userId: profile.id }, { skip: tab !== 'board' || isBlocked });

  // ─── C1b blocked (§3 c1Blocked): bar gọn "Đã chặn @…" + Bỏ chặn ───
  if (isBlocked) {
    return (
      <div style={{ maxWidth: 940, margin: '0 auto', padding: '24px 16px' }}>
        <div
          data-screen="C1"
          data-state="blocked"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            padding: 22,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 20,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15 }}>Đã chặn @{uname}</div>
          <div style={{ flex: 1 }} />
          <OutlineButton onClick={runUnblock}>Bỏ chặn</OutlineButton>
        </div>
      </div>
    );
  }

  async function runFollow() {
    if (status !== 'authenticated') {
      openAuthPrompt('theo dõi người này');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await followM({ variables: { userId: profile.id } });
      await refetchProfile();
      toast({ message: `Đang theo dõi ${dispName}` });
    } catch {
      toast({ message: 'Không theo dõi được, thử lại sau.' });
    } finally {
      setBusy(false);
    }
  }

  async function silentFollow() {
    try {
      await followM({ variables: { userId: profile.id } });
      await refetchProfile();
    } catch {
      /* undo lỗi — bỏ qua, trạng thái giữ nguyên */
    }
  }

  async function runUnfollow() {
    if (busy) return;
    setBusy(true);
    setHoverFollow(false);
    try {
      await unfollowM({ variables: { userId: profile.id } });
      await refetchProfile();
      toast({ message: `Đã bỏ theo dõi ${dispName}`, action: { label: 'Hoàn tác', onClick: silentFollow } });
    } catch {
      toast({ message: 'Lỗi, thử lại sau.' });
    } finally {
      setBusy(false);
    }
  }

  /**
   * FE-9 — nút "Tin nhắn" ở C1b. `createConversation` là **idempotent**: gọi lại
   * với cùng người trả về hội thoại ĐANG CÓ chứ không tạo trùng (đo bằng request
   * thật 17/08) ⇒ bấm nhiều lần vô hại, không cần tra trước xem đã có chưa.
   *
   * Nút đã bị `disabled` khi chưa mutual, nhưng vẫn bắt lỗi tử tế: `mutual` tính
   * từ field viewer-aware, mà quan hệ có thể đổi ở tab khác giữa chừng — và
   * backend mới là nơi quyết định (403 `Mutual follow is required…`).
   */
  async function runOpenConversation() {
    if (status !== 'authenticated') {
      openAuthPrompt('nhắn tin');
      return;
    }
    setBusy(true);
    try {
      const res = await createConversationM({ variables: { userId: profile.id } });
      const id = res.data?.createConversation?.id;
      if (id) router.push(`/messages/${id}`);
      else toast({ message: 'Không mở được cuộc trò chuyện. Thử lại nhé.' });
    } catch (e) {
      toast({ message: translateMessagingError(e instanceof Error ? e.message : '') });
    } finally {
      setBusy(false);
    }
  }

  async function runBlock() {
    setMenuOpen(false);
    if (status !== 'authenticated') {
      openAuthPrompt('chặn người này');
      return;
    }
    const ok = await confirm({
      title: `Chặn @${uname}?`,
      body: 'Họ không thấy pin của bạn và bạn không thấy pin của họ.',
      yesLabel: 'Chặn',
      danger: true,
    });
    if (!ok) return;
    try {
      await blockM({ variables: { userId: profile.id } });
      await refetchProfile();
      toast({ message: `Đã chặn @${uname}` });
    } catch {
      toast({ message: 'Không chặn được, thử lại sau.' });
    }
  }

  async function runUnblock() {
    const ok = await confirm({
      title: `Bỏ chặn @${uname}?`,
      body: 'Họ sẽ thấy lại pin của bạn và bạn thấy lại pin của họ.',
      yesLabel: 'Bỏ chặn',
    });
    if (!ok) return;
    try {
      await unblockM({ variables: { userId: profile.id } });
      await refetchProfile();
      toast({ message: `Đã bỏ chặn @${uname}` });
    } catch {
      toast({ message: 'Không bỏ chặn được, thử lại sau.' });
    }
  }

  const stateName = isSelf ? 'profile' : mutual ? 'mutual' : iFollow ? 'following' : followsMe ? 'followsyou' : 'nofollow';

  return (
    <div data-screen="C1" data-state={stateName} style={{ maxWidth: 940, margin: '0 auto', padding: '24px 16px 0' }}>
      {/* Ảnh bìa 150px + avatar 92px đè lên */}
      <div
        style={{
          height: 150,
          borderRadius: 20,
          background:
            'repeating-linear-gradient(135deg, var(--color-placeholder-a1) 0 16px, var(--color-placeholder-b1) 16px 32px)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -46 }}>
        <HeaderAvatar name={dispName} url={profile.avatarUrl} />
        <h1 style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 25, margin: '12px 0 2px', color: 'var(--color-foreground)' }}>
          {dispName}
        </h1>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)' }}>@{uname}</div>

        {!isSelf && followsMe && (
          <div
            style={{
              marginTop: 8,
              padding: '3px 12px',
              borderRadius: 999,
              background: 'var(--color-surface-muted)',
              color: 'var(--color-muted)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Đang theo dõi bạn
          </div>
        )}

        {profile.bio && (
          <p style={{ fontSize: 14, color: 'var(--color-muted)', maxWidth: 440, textAlign: 'center', margin: '10px 0 0', lineHeight: 1.6 }}>
            {profile.bio}
          </p>
        )}
        {profile.website && (
          <a
            href={profile.website}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{ fontSize: 13.5, marginTop: 9, fontWeight: 600, color: 'var(--color-primary-strong)' }}
          >
            {profile.website.replace(/^https?:\/\//, '')}
          </a>
        )}

        {/* 2 nút số đếm — trỏ C3 (ngoài phạm vi §9): giữ nút, chú thích qua toast */}
        <div style={{ display: 'flex', gap: 22, marginTop: 12, fontSize: 13.5 }}>
          <CountButton
            count={profile.followerCount ?? 0}
            label="người theo dõi"
            onClick={() => toast({ message: 'Danh sách người theo dõi sẽ có ở bản sau.' })}
          />
          <CountButton
            count={profile.followingCount ?? 0}
            label="đang theo dõi"
            onClick={() => toast({ message: 'Danh sách đang theo dõi sẽ có ở bản sau.' })}
          />
        </div>

        {/* Hàng nút — khác nhau giữa C1a và C1b */}
        <div style={{ display: 'flex', gap: 9, marginTop: 16, alignItems: 'center', position: 'relative' }}>
          {isSelf ? (
            <>
              <OutlineButton onClick={() => router.push('/settings')}>Sửa hồ sơ</OutlineButton>
              {/* C1a: nút này mở HỘP THƯ của mình (bản vẽ: c1Message → view messages),
                  không phải mở DM với chính mình — backend chặn việc đó (400). */}
              <OutlineButton onClick={() => router.push('/messages')}>Tin nhắn</OutlineButton>
            </>
          ) : (
            <>
              {iFollow ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={runUnfollow}
                  onMouseEnter={() => setHoverFollow(true)}
                  onMouseLeave={() => setHoverFollow(false)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 999,
                    border: hoverFollow ? 'none' : '1px solid var(--color-border)',
                    background: hoverFollow ? 'var(--color-danger)' : 'var(--color-surface)',
                    color: hoverFollow ? 'var(--color-danger-foreground)' : 'var(--color-foreground)',
                    fontWeight: 600,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    minWidth: 118,
                  }}
                >
                  {hoverFollow ? 'Bỏ theo dõi' : 'Đang theo dõi'}
                </button>
              ) : (
                <PrimaryButton disabled={busy} onClick={runFollow}>
                  Theo dõi
                </PrimaryButton>
              )}

              <button
                type="button"
                disabled={!mutual || busy}
                onClick={() => (mutual ? void runOpenConversation() : undefined)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 999,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-foreground)',
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: mutual ? 'pointer' : 'not-allowed',
                  opacity: mutual ? 1 : 0.7,
                }}
              >
                Tin nhắn
              </button>

              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title="Thêm"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-foreground)',
                  cursor: 'pointer',
                  fontSize: 15,
                }}
              >
                ⋯
              </button>

              {menuOpen && (
                <>
                  <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-dropdown)' as unknown as number }} />
                  <div
                    role="menu"
                    style={{
                      position: 'absolute',
                      top: 46,
                      right: 0,
                      minWidth: 180,
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      boxShadow: 'var(--shadow-modal)',
                      padding: 6,
                      zIndex: 'var(--z-sheet)' as unknown as number,
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={runBlock}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 14px',
                        border: 'none',
                        borderRadius: 10,
                        background: 'none',
                        color: 'var(--color-danger)',
                        fontWeight: 600,
                        fontSize: 13.5,
                        cursor: 'pointer',
                      }}
                    >
                      Chặn @{uname}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Dòng gợi ý khi Tin nhắn bị khoá (chưa mutual) — chép nguyên văn */}
        {!isSelf && !mutual && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 8 }}>
            Tin nhắn chỉ mở khi hai người theo dõi nhau.
          </div>
        )}

        {/* 2 tab Pin | Board */}
        <div style={{ display: 'flex', gap: 4, margin: '24px 0 18px', background: 'var(--color-surface-muted)', borderRadius: 999, padding: 4 }}>
          <TabButton label="Pin" active={tab === 'pin'} onClick={() => setTab('pin')} />
          <TabButton label="Board" active={tab === 'board'} onClick={() => setTab('board')} />
        </div>
      </div>

      {tab === 'pin' ? (
        pinsTab.items.length === 0 && !pinsTab.loading ? (
          <EmptyTab>Không có pin nào để hiển thị</EmptyTab>
        ) : (
          <PinGrid
            items={pinsTab.items}
            loading={pinsTab.loading}
            loadingMore={pinsTab.loadingMore}
            hasNextPage={pinsTab.hasNextPage}
            loadMore={pinsTab.loadMore}
            onOpen={(id) => router.push(`/pin/${id}`)}
          />
        )
      ) : (
        <BoardsGrid
          boards={boardsTab.items}
          loading={boardsTab.loading}
          onOpen={(id) => router.push(`/board/${id}`)}
        />
      )}
    </div>
  );
}

// ─── Board grid ───────────────────────────────────────────────────────────────

function BoardsGrid({
  boards,
  loading,
  onOpen,
}: {
  boards: ReadonlyArray<{
    id: string;
    name?: string | null;
    isSecret?: boolean | null;
    pinCount?: number | null;
    coverPin?: { imageUrl: string; thumbnailUrl?: string | null } | null;
  }>;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (loading && boards.length === 0) {
    return <EmptyTab>Đang tải board…</EmptyTab>;
  }
  if (boards.length === 0) {
    return <EmptyTab>Chưa có board nào</EmptyTab>;
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 16,
        padding: '0 16px 24px',
      }}
    >
      {boards.map((b) => {
        const cover = b.coverPin?.thumbnailUrl ?? b.coverPin?.imageUrl ?? null;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onOpen(b.id)}
            style={{ textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
          >
            <div
              style={{
                aspectRatio: '4 / 3',
                borderRadius: 16,
                overflow: 'hidden',
                background: 'var(--color-surface-muted)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {cover && <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.name}
              </div>
              {b.isSecret && <span title="Riêng tư" aria-label="Riêng tư" style={{ fontSize: 12 }}>🔒</span>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2 }}>
              {formatCount(b.pinCount ?? 0)} pin
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Bits dùng lại trong C1 ────────────────────────────────────────────────────

function HeaderAvatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const border = '4px solid var(--color-background)';
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        style={{ width: 92, height: 92, borderRadius: '50%', objectFit: 'cover', border }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 92,
        height: 92,
        borderRadius: '50%',
        background: 'var(--color-primary)',
        color: 'var(--color-primary-foreground)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: 32,
        border,
      }}
    >
      {initial}
    </div>
  );
}

function CountButton({ count, label, onClick }: { count: number; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-foreground)', fontSize: 13.5 }}>
      <b>{formatCount(count)}</b> <span style={{ color: 'var(--color-muted)' }}>{label}</span>
    </button>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      style={{
        padding: '8px 22px',
        borderRadius: 999,
        border: 'none',
        background: active ? 'var(--color-surface)' : 'transparent',
        color: active ? 'var(--color-foreground)' : 'var(--color-muted)',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        fontWeight: 600,
        fontSize: 13.5,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function EmptyTab({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 14 }}>
      {children}
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px' }}>
      <div style={{ padding: '48px 20px', textAlign: 'center', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 20 }}>
        {children}
      </div>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, style }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '10px 20px',
        borderRadius: 999,
        border: 'none',
        background: 'var(--color-primary)',
        color: 'var(--color-primary-foreground)',
        fontWeight: 700,
        fontSize: 13.5,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.7 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function OutlineButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 20px',
        borderRadius: 999,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-foreground)',
        fontWeight: 600,
        fontSize: 13.5,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
