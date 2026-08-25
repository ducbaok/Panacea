'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation } from '@apollo/client/react';
import {
  FeedSource,
  SuggestedUsersDocument,
  type SuggestedUsersQuery,
  FollowDocument,
  type FollowMutation,
  type FollowMutationVariables,
  MyCirclesDocument,
  type MyCirclesQuery,
  type MyCirclesQueryVariables,
} from '@/lib/gql/graphql';
import { useHomeFeed } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import { ExploreSection } from '@/components/home/explore-section';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';
import { useT } from '@/lib/i18n/provider';

/**
 * B1 — Trang chủ (FE-6). Hai vai:
 *   • Khách vãng lai → nội dung Khám phá (homeFeed bắt buộc auth, QĐ-1).
 *   • Đã đăng nhập → homeFeed 2 trạng thái FOLLOWING/EXPLORE, phân biệt bằng
 *     `HomeFeed.source` (backend quyết, client ép được qua §6b.1).
 *
 * Tách AuthHome/GuestHome thành 2 component để KHÔNG gọi hook có điều kiện.
 */
export function HomeView() {
  const { status } = useSession();
  if (status === 'authenticated') return <AuthHome />;
  if (status === 'unauthenticated') return <GuestHome />;
  // status === 'loading': khung xương masonry, tránh nháy giữa hai nhánh.
  return (
    <div className="py-6">
      <PinGrid items={[]} loading loadingMore={false} hasNextPage={false} loadMore={() => {}} />
    </div>
  );
}

function GuestHome() {
  // REVIEW-1 (#2) — khách cũng cần dải chip chủ đề: `/explore` đã bỏ khỏi nav
  // nên đây là đường duy nhất còn lại để lọc theo chủ đề.
  return (
    <div style={{ padding: '24px 0 0' }}>
      <div style={{ padding: '0 16px' }}>
        <ExploreSection />
      </div>
    </div>
  );
}

/**
 * Nguồn đang xem ở trang chủ. Nhánh vòng mang theo id NGAY TRONG giá trị tab
 * chứ không nằm ở một state riêng — xem docblock của `tab` trong `AuthHome`.
 */
type HomeTab = 'following' | 'explore' | { circleId: string };

const tabCircleId = (t: HomeTab | null): string | null =>
  t !== null && typeof t === 'object' ? t.circleId : null;

/**
 * Khoá localStorage cho việc đóng banner gợi ý (#5).
 * Đặt tên có tiền tố màn để sau này còn phân biệt được với các dismiss khác.
 */
const SUGGEST_DISMISS_KEY = 'home:suggest-dismissed';

function readDismissed(): boolean {
  // try/catch: Safari chế độ riêng tư ném ngay ở bước ĐỌC localStorage.
  // Đọc trong lazy initializer của useState — AuthHome chỉ mount sau khi phiên
  // đã resolve (client-only) nên không có nguy cơ lệch hydration.
  try {
    return window.localStorage.getItem(SUGGEST_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function AuthHome() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();

  /**
   * REVIEW-1 (#2) — `tab` thay cho `forcedSource` cũ.
   *   null      = chưa chọn, để backend tự quyết nguồn (giữ QĐ-1).
   *   'following' / 'explore' = người dùng đã chọn tường minh.
   *   { circleId } = nhánh THỨ BA (XH-QĐ-17 / luồng D) — xem riêng một vòng.
   *
   * Phải phân biệt "explore vì backend fallback (chưa follow ai)" với "explore
   * vì người dùng bấm chip" — bản cũ gộp cả hai vào `source === EXPLORE`, nên
   * bấm chip Khám phá là banner "Bạn chưa theo dõi ai" hiện lại dù người dùng
   * đang theo dõi cả chục người.
   *
   * ⚠️ NHÁNH VÒNG VÀO ĐÚNG BIẾN `tab` NÀY, KHÔNG THÊM MỘT STATE THỨ HAI. Một
   * `circleId` sống song song với `tab` là hai nguồn sự thật cho cùng một câu
   * hỏi ("đang xem gì"), và chúng sẽ lệch nhau đúng ở chỗ bản cũ đã lệch: bấm
   * chip vòng rồi bấm lại Khám phá thì `circleId` cũ còn nguyên, request đi
   * kèm cả `source=EXPLORE` lẫn `circleId` — backend NÉM (cặp lệch, luồng D)
   * và người dùng thấy lưới trắng. Một biến thì trạng thái đó không tồn tại.
   */
  const [tab, setTab] = useState<HomeTab | null>(null);

  /**
   * Danh sách vòng cho dải chip. `includeAdHoc: false` — khán giả chọn tại chỗ
   * ẨN khỏi mọi bề mặt quản lý (XH-QĐ-5), và tên của chúng là chuỗi RỖNG nên
   * chip sẽ không có chữ. QĐ-26: không có vòng nào ⇒ ẩn CẢ chip LẪN vạch ngăn.
   */
  const circlesQuery = useQuery<MyCirclesQuery, MyCirclesQueryVariables>(MyCirclesDocument, {
    variables: { includeAdHoc: false },
  });
  const circles = circlesQuery.data?.myCircles ?? [];

  /**
   * Vòng đang chọn có thể BIẾN MẤT giữa chừng (xoá ở tab khác, hoặc chủ vòng
   * bớt mình ra). Không rơi về nhánh mặc định thì `homeFeed` trả 404 "Circle
   * not found" và người dùng nhận lưới trắng không lời giải thích.
   *
   * Xử bằng cách SUY RA lúc render, KHÔNG `setTab` trong `useEffect`: đặt lại
   * state trong effect thì lần render đầu vẫn kịp bắn một request 404 (effect
   * chạy SAU render) và lưới nháy trắng một nhịp — chưa kể lint của dự án cấm
   * đúng hình dạng đó. Vòng biến mất thì tab CHỈ ĐƯỢC ĐỌC như 'following';
   * `tab` giữ nguyên giá trị cũ và không ai nhìn thấy nó nữa vì chip tương ứng
   * cũng đã rụng khỏi danh sách.
   */
  const requestedCircleId = tabCircleId(tab);
  const circleGone =
    requestedCircleId != null &&
    !circlesQuery.loading &&
    !circles.some((c) => c.id === requestedCircleId);

  const activeTab: HomeTab | null = circleGone ? 'following' : tab;
  const activeCircleId = tabCircleId(activeTab);

  const feed = useHomeFeed(
    activeCircleId
      ? { source: FeedSource.Circle, circleId: activeCircleId }
      : activeTab === 'following'
        ? { source: FeedSource.Following }
        : {},
    { skip: activeTab === 'explore' },
  );

  // Nguồn THỰC backend trả về. Chỉ có nghĩa khi không ở tab explore (lúc đó
  // homeFeed bị skip nên `feed.source` là giá trị cũ).
  const source = feed.source;

  // `fallback` = backend tự chọn EXPLORE vì người dùng chưa theo dõi ai. Đây
  // mới là điều kiện đúng cho banner, không phải "đang xem explore".
  const isFallbackExplore = activeTab === null && source === FeedSource.Explore;
  const effectiveTab: HomeTab = activeTab ?? (isFallbackExplore ? 'explore' : 'following');

  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  const dismissBanner = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(SUGGEST_DISMISS_KEY, '1');
    } catch {
      // Không ghi được thì banner sẽ hiện lại ở lần tải sau — chấp nhận,
      // đóng trong phiên vẫn có tác dụng.
    }
  };

  const showFollowingEmpty =
    effectiveTab === 'following' && !feed.loading && feed.items.length === 0;

  /**
   * Card rỗng của vòng CỐ Ý khác card rỗng FOLLOWING (spec §2 trạng thái 3):
   * đây là nhóm thân, "chưa ai chia sẻ gì riêng cho nhóm này" chứ không phải
   * "bạn chưa theo dõi ai". Cùng một lưới rỗng, hai câu chuyện khác nhau.
   */
  const showCircleEmpty = activeCircleId != null && !feed.loading && feed.items.length === 0;

  return (
    <div style={{ padding: '24px 0 0' }}>
      <div style={{ padding: '0 16px' }}>
        {/* Banner gợi ý — chỉ khi backend FALLBACK sang explore VÀ chưa bị đóng */}
        {isFallbackExplore && !dismissed && (
          <div
            data-screen="home"
            data-state="explore-banner"
            style={{
              position: 'relative', // mốc cho nút ✕ (#5)
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--color-primary-soft)',
              border: '1px solid var(--color-border)',
              borderRadius: 18,
              padding: '16px 44px 16px 20px', // chừa chỗ nút ✕ bên phải
              marginBottom: 16,
            }}
          >
            <div style={{ minWidth: 240, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--color-foreground)' }}>
                {t('home.suggestBannerTitle')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 4, lineHeight: 1.5 }}>
                {t('home.suggestBannerBody')}
              </div>
            </div>
            <SuggestionBlock />
            {/* REVIEW-1 (#5) — nút đóng; ghi nhớ qua localStorage nên F5 không hiện lại */}
            <button
              type="button"
              aria-label={t('home.dismissSuggest')}
              title={t('home.dismissSuggest')}
              data-testid="dismiss-suggest"
              onClick={dismissBanner}
              style={{
                position: 'absolute',
                top: 8,
                right: 10,
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                border: 'none',
                background: 'transparent',
                color: 'var(--color-muted)',
                fontSize: 18,
                lineHeight: 1,
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Chip nguồn — 2 chip cố định + dải chip vòng, active = nguồn THỰC
            (không phải forced). Bản vẽ XH-CIRCLE-FEED: hàng chip cuộn NGANG,
            vạch ngăn 1px giữa hai nhóm. `maxWidth: '100%'` + `overflowX` là
            thứ giữ cho 20 vòng (trần XH-QĐ-13) không đẩy vỡ lưới bên dưới. */}
        <div
          role="tablist"
          aria-label={t('home.sourceTablist')}
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--color-surface-muted)',
            borderRadius: 999,
            padding: 4,
            marginBottom: 16,
            maxWidth: '100%',
            width: 'fit-content',
            overflowX: 'auto',
          }}
        >
          <SourceChip
            label={t('home.tabFollowing')}
            active={effectiveTab === 'following'}
            onClick={() => setTab('following')}
          />
          <SourceChip
            label={t('home.tabExplore')}
            active={effectiveTab === 'explore'}
            onClick={() => setTab('explore')}
          />
          {/* QĐ-26 — chưa có vòng nào thì ẨN CẢ vạch ngăn lẫn chip. Bản vẽ luôn
              có vòng nên nhánh này không có trong bundle; ghi rõ ở
              `ban-do-man-panacea.md` là FE tự xử. */}
          {circles.length > 0 && (
            <>
              <span
                aria-hidden
                style={{
                  width: 1,
                  height: 24,
                  background: 'var(--color-border)',
                  flex: 'none',
                  margin: '4px 3px',
                }}
              />
              {circles.map((c) => (
                <SourceChip
                  key={c.id}
                  label={c.name}
                  active={activeCircleId === c.id}
                  onClick={() => setTab({ circleId: c.id })}
                />
              ))}
            </>
          )}
        </div>

      </div>

      {/* REVIEW-1 (#2) — dải chip chủ đề + lưới của tab Khám phá.
          Đặt NGOÀI khối padding: `ExploreSection` tự thụt lề cho dải chip, còn
          lưới masonry phải chạm mép để tính đúng số cột.
          Mount cả khi đang ở tab kia nhưng `skip` ⇒ không bắn query thừa, mà
          chủ đề đang chọn vẫn không mất khi đổi qua lại tab. */}
      <div style={{ display: effectiveTab === 'explore' ? 'block' : 'none' }}>
        <ExploreSection skip={effectiveTab !== 'explore'} />
      </div>

      {effectiveTab === 'explore' ? null : showCircleEmpty ? (
        <CircleEmptyCard onCreate={() => router.push('/pin/new')} />
      ) : showFollowingEmpty ? (
        <FollowingEmptyCard onExplore={() => setTab('explore')} />
      ) : (
        <PinGrid
          items={feed.items}
          loading={feed.loading}
          loadingMore={feed.loadingMore}
          hasNextPage={feed.hasNextPage}
          loadMore={feed.loadMore}
          onOpen={(id) => router.push(`/pin/${id}`)}
        />
      )}
    </div>
  );
}

/**
 * `label` là CHỮ ĐÃ DỊCH, không phải key: tên vòng do người dùng đặt nên nó
 * không nằm trong từ điển. Hai chip cố định tự dịch ở nơi gọi.
 */
function SourceChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '8px 18px',
        borderRadius: 999,
        border: 'none',
        background: active ? 'var(--color-surface)' : 'transparent',
        color: active ? 'var(--color-foreground)' : 'var(--color-muted)',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        fontWeight: 600,
        fontSize: 13.5,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flex: 'none',
        maxWidth: 180,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </button>
  );
}

/**
 * Card rỗng FOLLOWING (§3 B1) — hiện khi ép FOLLOWING mà chưa follow ai. Chép
 * NGUYÊN VĂN 3 chuỗi từ bản vẽ (§9: chép, đừng sáng tác).
 */
function FollowingEmptyCard({ onExplore }: { onExplore: () => void }) {
  const t = useT();
  return (
    <div
      data-screen="home"
      data-state="empty-following"
      style={{
        margin: '0 16px',
        padding: '64px 24px',
        textAlign: 'center',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 21, color: 'var(--color-foreground)' }}>
        {t('home.emptyFollowingTitle')}
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--color-muted)',
          marginTop: 8,
          lineHeight: 1.6,
          maxWidth: 420,
        }}
      >
        {t('home.emptyFollowingBody')}
      </div>
      <button
        type="button"
        onClick={onExplore}
        style={{
          marginTop: 18,
          padding: '11px 22px',
          borderRadius: 999,
          border: 'none',
          background: 'var(--color-primary)',
          color: 'var(--color-primary-foreground)',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {t('home.seeExplore')}
      </button>
    </div>
  );
}

/**
 * Card rỗng của FEED VÒNG (bản vẽ XH-CIRCLE-FEED, state `empty-circle`). Chép
 * nguyên văn 3 chuỗi từ bản vẽ — §9: chép, đừng sáng tác.
 *
 * ⚠️ Nút "Đăng cho vòng này" điều hướng sang `/pin/new` mà KHÔNG chọn sẵn vòng.
 * Bản vẽ ghi `createPin(visibility:CIRCLE)`, nhưng chọn sẵn khán giả phải sửa
 * `create-pin-view.tsx` — vùng file của luồng F1, ngoài phạm vi luồng D
 * (`xahoi-dieu-phoi.md` §3). Ghi lại thành việc còn thiếu thay vì lấn vùng.
 */
function CircleEmptyCard({ onCreate }: { onCreate: () => void }) {
  const t = useT();
  return (
    <div
      data-screen="XH-CIRCLE-FEED"
      data-state="empty-circle"
      style={{
        margin: '0 16px',
        padding: '56px 24px',
        textAlign: 'center',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div style={{ fontFamily: "'Varela Round', sans-serif", fontSize: 21, color: 'var(--color-foreground)' }}>
        {t('home.emptyCircleTitle')}
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--color-muted)',
          marginTop: 8,
          lineHeight: 1.6,
          maxWidth: 460,
        }}
      >
        {t('home.emptyCircleBody')}
      </div>
      <button
        type="button"
        onClick={onCreate}
        style={{
          marginTop: 18,
          padding: '11px 22px',
          borderRadius: 999,
          border: 'none',
          background: 'var(--color-primary)',
          color: 'var(--color-primary-foreground)',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {t('home.postToCircle')}
      </button>
    </div>
  );
}

/**
 * Khối gợi ý người theo dõi (§4.2 / B-12). QĐ-9: hiện đúng số API trả về, CO LẠI
 * khi < 3, chỉ ẨN khi trả về 0. Bấm Theo dõi ⇒ follow thật + gỡ chip (follow
 * KHÔNG có Hoàn tác — chỉ bỏ-theo-dõi mới có, §1 toast).
 */
function SuggestionBlock() {
  const t = useT();
  const toast = useToast();
  const { data } = useQuery<SuggestedUsersQuery>(SuggestedUsersDocument, {
    variables: { first: 3 },
  });
  const [followMutation] = useMutation<FollowMutation, FollowMutationVariables>(FollowDocument);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  const users = (data?.suggestedUsers ?? []).filter((u) => !followed.has(u.id));
  if (users.length === 0) return null; // QĐ-9: chỉ ẩn khi 0

  const onFollow = async (u: SuggestedUsersQuery['suggestedUsers'][number]) => {
    setFollowed((s) => new Set(s).add(u.id)); // optimistic: gỡ chip ngay
    try {
      await followMutation({ variables: { userId: u.id } });
      toast({
        message: t('home.followed', { handle: u.username ?? u.name ?? t('home.someone') }),
      });
    } catch {
      setFollowed((s) => {
        const n = new Set(s);
        n.delete(u.id);
        return n;
      });
      toast({ message: t('home.followFailed') });
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {users.map((u) => (
        <div
          key={u.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            padding: '5px 6px 5px 8px',
          }}
        >
          <Avatar name={u.name ?? u.username} url={u.avatarUrl} size={28} />
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-foreground)', maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {u.name ?? u.username}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
              {t('home.followerCount', {
                count: u.followerCount ?? 0,
                countText: formatCount(u.followerCount ?? 0),
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onFollow(u)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: 'none',
              background: 'var(--color-primary)',
              color: 'var(--color-primary-foreground)',
              fontWeight: 700,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {t('home.follow')}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, url, size = 40 }: { name?: string | null; url?: string | null; size?: number }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ''}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-primary-soft)',
        color: 'var(--color-primary-strong)',
        fontWeight: 700,
        fontSize: size * 0.42,
      }}
    >
      {initial}
    </div>
  );
}
