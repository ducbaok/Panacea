'use client';

import { useMemo, useState } from 'react';
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
import { messagingErrorKey } from '@/components/messages/chat-panel';
import { useUserPins, useUserBoards, useSavedPins } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { useAvatarUpload } from '@/components/profile/use-avatar-upload';
import { formatCount } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

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
  const t = useT();
  const { status } = useSession();
  const profileQuery = useQuery<UserByUsernameQuery>(UserByUsernameDocument, {
    variables: { username },
  });
  const meQuery = useQuery<MeQuery>(MeDocument, { skip: status !== 'authenticated' });

  if (profileQuery.loading) return <CenteredCard>{t('profile.loading')}</CenteredCard>;

  if (profileQuery.error) {
    return (
      <CenteredCard>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{t('profile.loadFailed')}</div>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
          {t('common.checkNetwork')}
        </div>
        <PrimaryButton onClick={() => profileQuery.refetch()} style={{ marginTop: 16 }}>
          {t('common.retry')}
        </PrimaryButton>
      </CenteredCard>
    );
  }

  const profile = profileQuery.data?.userByUsername;
  if (!profile) {
    return (
      <CenteredCard>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{t('profile.notFound')}</div>
        <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginTop: 6 }}>
          {t('profile.notFoundBody', { username })}
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
  const t = useT();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { status } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  // REVIEW-1 (#7) — thêm tab 'saved'. Trước đợt này pin lưu bằng nút "Lưu" mặc
  // định (không chọn board) không hiện ở BẤT KỲ màn nào.
  const [tab, setTab] = useState<'pin' | 'board' | 'saved'>('pin');
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
  const savedTab = useSavedPins({ userId: profile.id }, { skip: tab !== 'saved' || isBlocked });

  /**
   * REVIEW-1 (#7) — gộp theo `pin.id`.
   *
   * Server trả về từng dòng `SavedPin`, và một pin lưu vào nhiều board là nhiều
   * dòng (`@@unique([userId, pinId, boardId])`). Không gộp thì cùng một pin
   * hiện lặp trong lưới. Gộp ở FE chứ không ở server vì dedupe server-side đòi
   * `DISTINCT ON` raw SQL, phá khuôn keyset dùng chung toàn dự án — đánh đổi:
   * một trang có thể hiển thị ít hơn `first` thẻ (đã ghi ở B-21).
   */
  const savedPinItems = useMemo(() => {
    const seen = new Set<string>();
    const out: NonNullable<(typeof savedTab.items)[number]['pin']>[] = [];
    for (const sp of savedTab.items) {
      const pin = sp.pin;
      if (!pin || seen.has(pin.id)) continue;
      seen.add(pin.id);
      out.push(pin);
    }
    return out;
  }, [savedTab.items]);

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
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {t('profile.blockedTitle', { username: uname })}
          </div>
          <div style={{ flex: 1 }} />
          <OutlineButton onClick={runUnblock}>{t('profile.unblock')}</OutlineButton>
        </div>
      </div>
    );
  }

  async function runFollow() {
    if (status !== 'authenticated') {
      openAuthPrompt('auth.actionFollow');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await followM({ variables: { userId: profile.id } });
      await refetchProfile();
      toast({ message: t('profile.nowFollowing', { name: dispName }) });
    } catch {
      toast({ message: t('profile.followFailed') });
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
      toast({
        message: t('profile.unfollowed', { name: dispName }),
        action: { label: t('profile.undo'), onClick: silentFollow },
      });
    } catch {
      toast({ message: t('profile.genericError') });
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
      openAuthPrompt('auth.actionMessage');
      return;
    }
    setBusy(true);
    try {
      const res = await createConversationM({ variables: { userId: profile.id } });
      const id = res.data?.createConversation?.id;
      if (id) router.push(`/messages/${id}`);
      else toast({ message: t('profile.openChatFailed') });
    } catch (e) {
      toast({ message: t(messagingErrorKey(e instanceof Error ? e.message : '')) });
    } finally {
      setBusy(false);
    }
  }

  async function runBlock() {
    setMenuOpen(false);
    if (status !== 'authenticated') {
      openAuthPrompt('auth.actionBlock');
      return;
    }
    const ok = await confirm({
      title: t('profile.blockTitle', { username: uname }),
      body: t('profile.blockBody'),
      yesLabel: t('profile.blockYes'),
      danger: true,
    });
    if (!ok) return;
    try {
      await blockM({ variables: { userId: profile.id } });
      await refetchProfile();
      toast({ message: t('profile.blocked', { username: uname }) });
    } catch {
      toast({ message: t('profile.blockFailed') });
    }
  }

  async function runUnblock() {
    const ok = await confirm({
      title: t('profile.unblockTitle', { username: uname }),
      body: t('profile.unblockBody'),
      yesLabel: t('profile.unblock'),
    });
    if (!ok) return;
    try {
      await unblockM({ variables: { userId: profile.id } });
      await refetchProfile();
      toast({ message: t('profile.unblocked', { username: uname }) });
    } catch {
      toast({ message: t('profile.unblockFailed') });
    }
  }

  const stateName = isSelf ? 'profile' : mutual ? 'mutual' : iFollow ? 'following' : followsMe ? 'followsyou' : 'nofollow';

  return (
    <div data-screen="C1" data-state={stateName} style={{ maxWidth: 940, margin: '0 auto', padding: '24px 16px 0' }}>
      {/* Ảnh bìa 150px + avatar 92px đè lên. REVIEW-1 (#6): trước đợt này dải
          bìa CHỈ là gradient trang trí, không có đường nào đặt ảnh thật. */}
      <CoverBand url={profile.coverUrl} editable={isSelf} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -46 }}>
        <HeaderAvatar name={dispName} url={profile.avatarUrl} editable={isSelf} />
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
            {t('profile.followsYou')}
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

        {/* 2 nút số đếm → C3 (FE-10 mở khoá; trước đó chỉ hiện toast "sẽ có ở
            bản sau"). Đích là chính `uname` đang xem, KHÔNG phải người đăng nhập —
            C3 xem được danh sách của người khác. */}
        <div style={{ display: 'flex', gap: 22, marginTop: 12, fontSize: 13.5 }}>
          <CountButton
            count={profile.followerCount ?? 0}
            label={t('profile.followerLabel', { count: profile.followerCount ?? 0 })}
            onClick={() => router.push(`/@${uname}/followers`)}
          />
          <CountButton
            count={profile.followingCount ?? 0}
            label={t('profile.followingLabel')}
            onClick={() => router.push(`/@${uname}/following`)}
          />
        </div>

        {/* Hàng nút — khác nhau giữa C1a và C1b */}
        <div style={{ display: 'flex', gap: 9, marginTop: 16, alignItems: 'center', position: 'relative' }}>
          {isSelf ? (
            <>
              <OutlineButton onClick={() => router.push('/settings')}>{t('profile.editProfile')}</OutlineButton>
              {/* C1a: nút này mở HỘP THƯ của mình (bản vẽ: c1Message → view messages),
                  không phải mở DM với chính mình — backend chặn việc đó (400). */}
              <OutlineButton onClick={() => router.push('/messages')}>{t('profile.messages')}</OutlineButton>
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
                  {hoverFollow ? t('profile.unfollow') : t('profile.following')}
                </button>
              ) : (
                <PrimaryButton disabled={busy} onClick={runFollow}>
                  {t('profile.follow')}
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
                {t('profile.messages')}
              </button>

              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                title={t('profile.more')}
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
                      {t('profile.block', { username: uname })}
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
            {t('profile.messagesMutualOnly')}
          </div>
        )}

        {/* 3 tab Pin | Board | Đã lưu.
            REVIEW-1 (#7): bản vẽ C1 chốt 2 tab, tab thứ ba thêm theo yêu cầu
            người dùng — pin lưu bằng nút "Lưu" mặc định trước nay không có chỗ
            nào hiển thị. */}
        <div style={{ display: 'flex', gap: 4, margin: '24px 0 18px', background: 'var(--color-surface-muted)', borderRadius: 999, padding: 4 }}>
          <TabButton label={t('profile.tabPins')} active={tab === 'pin'} onClick={() => setTab('pin')} />
          <TabButton label={t('profile.tabBoards')} active={tab === 'board'} onClick={() => setTab('board')} />
          <TabButton label={t('profile.tabSaved')} active={tab === 'saved'} onClick={() => setTab('saved')} />
        </div>
      </div>

      {tab === 'pin' ? (
        pinsTab.items.length === 0 && !pinsTab.loading ? (
          <EmptyTab>{t('profile.emptyPins')}</EmptyTab>
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
      ) : tab === 'board' ? (
        <BoardsGrid
          boards={boardsTab.items}
          loading={boardsTab.loading}
          onOpen={(id) => router.push(`/board/${id}`)}
        />
      ) : savedPinItems.length === 0 && !savedTab.loading ? (
        <EmptyTab>
          {isSelf ? t('profile.emptySavedSelf') : t('profile.emptySavedOther')}
        </EmptyTab>
      ) : (
        <PinGrid
          items={savedPinItems}
          loading={savedTab.loading}
          loadingMore={savedTab.loadingMore}
          hasNextPage={savedTab.hasNextPage}
          loadMore={savedTab.loadMore}
          onOpen={(id) => router.push(`/pin/${id}`)}
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
  const t = useT();
  if (loading && boards.length === 0) {
    return <EmptyTab>{t('profile.loadingBoards')}</EmptyTab>;
  }
  if (boards.length === 0) {
    return <EmptyTab>{t('profile.emptyBoards')}</EmptyTab>;
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
              {b.isSecret && (
                <span title={t('profile.secret')} aria-label={t('profile.secret')} style={{ fontSize: 12 }}>
                  🔒
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2 }}>
              {t('profile.pinCount', {
                count: b.pinCount ?? 0,
                countText: formatCount(b.pinCount ?? 0),
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Bits dùng lại trong C1 ────────────────────────────────────────────────────

/**
 * Avatar 92×92 của C1/C1a. `editable` (chỉ hồ sơ CỦA MÌNH) thêm nút camera tròn
 * 32×32 đè góc phải-dưới — bản vẽ C1a của `Panacea-v2.1.html`, không nhãn chữ,
 * `title="Đổi ảnh đại diện"`.
 */
/**
 * REVIEW-1 (#6) — dải bìa hồ sơ: ảnh thật nếu có, gradient cũ nếu chưa đặt.
 *
 * Bản vẽ C1b ghi thẳng "không có ảnh bìa thật", nên dải này vốn chỉ là
 * `repeating-linear-gradient` trang trí và KHÔNG có đường nào đổi được — đúng
 * thứ người dùng báo thiếu (18/08/2026). Nay `User.coverUrl` đã tồn tại ở mọi
 * tầng; gradient cũ trở thành fallback khi chưa đặt ảnh, nên hồ sơ chưa có bìa
 * trông y hệt trước, không cần backfill dữ liệu.
 *
 * Dùng lại `useAvatarUpload('coverUrl')` — cùng luồng upload với ảnh đại diện.
 */
function CoverBand({ url, editable }: { url?: string | null; editable?: boolean }) {
  const t = useT();
  const coverUpload = useAvatarUpload('coverUrl');

  const band = url ? (
    <img
      src={url}
      alt=""
      style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 20, display: 'block' }}
    />
  ) : (
    <div
      aria-hidden
      style={{
        height: 150,
        borderRadius: 20,
        background:
          'repeating-linear-gradient(135deg, var(--color-placeholder-a1) 0 16px, var(--color-placeholder-b1) 16px 32px)',
      }}
    />
  );

  if (!editable) return band;

  return (
    <div style={{ position: 'relative' }}>
      {band}
      <input {...coverUpload.inputProps} />
      <button
        type="button"
        onClick={coverUpload.pick}
        disabled={coverUpload.phase === 'working'}
        title={t('profile.changeCover')}
        aria-label={t('profile.changeCover')}
        data-testid="change-cover"
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 12px',
          borderRadius: 999,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-foreground)',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: coverUpload.phase === 'working' ? 'wait' : 'pointer',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <CameraIcon />
        {coverUpload.phase === 'working' ? t('common.loading') : t('profile.changeCover')}
      </button>
    </div>
  );
}

function HeaderAvatar({
  name,
  url,
  editable,
}: {
  name?: string | null;
  url?: string | null;
  editable?: boolean;
}) {
  const t = useT();
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const border = '4px solid var(--color-background)';
  const avatarUpload = useAvatarUpload();

  const face = url ? (
    <img
      src={url}
      alt={name ?? ''}
      style={{ width: 92, height: 92, borderRadius: '50%', objectFit: 'cover', border }}
    />
  ) : (
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

  if (!editable) return face;

  return (
    <div style={{ position: 'relative', width: 92, height: 92 }}>
      {face}
      <input {...avatarUpload.inputProps} />
      <button
        type="button"
        onClick={avatarUpload.pick}
        disabled={avatarUpload.phase === 'working'}
        title={t('profile.changeAvatar')}
        aria-label={t('profile.changeAvatar')}
        style={{
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '2px solid var(--color-background)',
          background: 'var(--color-surface)',
          color: 'var(--color-foreground)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          cursor: avatarUpload.phase === 'working' ? 'wait' : 'pointer',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <CameraIcon />
      </button>
    </div>
  );
}

/** Icon camera 15×15 — bản vẽ C1a/C2 dùng cùng một hình. */
function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l.9-1.6a1 1 0 0 1 .87-.5h5.06a1 1 0 0 1 .87.5L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
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
