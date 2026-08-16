'use client';

import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@apollo/client/react';
import { useSession } from 'next-auth/react';
import { FollowDocument, UnfollowDocument } from '@/lib/gql/graphql';
import { useSearchPins, useSearchUsers, useSearchBoards } from '@/lib/hooks/usePaginatedQuery';
import { PinGrid } from '@/components/pin/pin-grid';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { useToast } from '@/components/ui/toast';
import { formatCount } from '@/lib/format';

/**
 * D1 — Tìm kiếm (FE-8). 3 tab Pin / Người dùng / Board.
 *
 * ⚠️ `search` gọi lại cho MỖI tab: `type` bắt buộc, mỗi response chỉ điền một
 * nhánh `SearchResponse` (brief §3.1). Ba tab = ba component con render có điều
 * kiện ⇒ chỉ tab đang mở mới bắn query (hook mount/unmount theo tab).
 *
 * Ô tìm kiếm: desktop dùng ô ở TopBar (đã đẩy /search?q=). Mobile ẩn ô TopBar nên
 * dựng ô TRONG màn (`md:hidden`) — nếu không, mobile không có cách nào gõ từ khoá.
 *
 * Lệch bản vẽ đã chốt với user 16/08:
 *   • Tab Người dùng: hiện `@username` (API không có số pin/người) — QĐ.
 *   • Thẻ Board: 1 ảnh bìa `coverPin` (API chỉ có 1), không phải collage 3 ảnh.
 *   • Trạng thái rỗng tab Người dùng/Board: bản vẽ không vẽ ⇒ chữ đã duyệt.
 */

type Tab = 'pin' | 'user' | 'board';
const PAGE = 20;

export function SearchView({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery.trim());
  const [tab, setTab] = useState<Tab>('pin');

  // Đồng bộ khi TopBar điều hướng /search?q=… lúc màn đã mount (prop đổi).
  useEffect(() => {
    setQuery(initialQuery);
    setSubmitted(initialQuery.trim());
  }, [initialQuery]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    setSubmitted(q);
    router.replace(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  const hasQuery = submitted.length > 0;

  return (
    <div style={{ padding: '24px 0 0' }} data-screen="D1-search">
      <div style={{ padding: '0 16px' }}>
        {/* Ô tìm kiếm trong màn — chỉ mobile (desktop dùng ô ở TopBar) */}
        <form
          role="search"
          onSubmit={onSubmit}
          className="md:hidden"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--color-surface-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 999,
            padding: '10px 16px',
            marginBottom: 18,
          }}
        >
          <input
            type="search"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm pin, người dùng, board"
            aria-label="Ô tìm kiếm"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--color-foreground)', width: '100%' }}
          />
        </form>

        {hasQuery && (
          <h1
            style={{
              fontFamily: "'Varela Round', var(--font-be-vietnam-pro), sans-serif",
              fontSize: 22,
              margin: '0 0 14px',
              color: 'var(--color-foreground)',
            }}
          >
            Kết quả cho “{submitted}”
          </h1>
        )}

        {hasQuery && (
          <div
            role="tablist"
            aria-label="Loại kết quả"
            style={{
              display: 'inline-flex',
              gap: 4,
              background: 'var(--color-surface-muted)',
              borderRadius: 999,
              padding: 4,
              marginBottom: 20,
            }}
          >
            <TabPill label="Pin" active={tab === 'pin'} onClick={() => setTab('pin')} />
            <TabPill label="Người dùng" active={tab === 'user'} onClick={() => setTab('user')} />
            <TabPill label="Board" active={tab === 'board'} onClick={() => setTab('board')} />
          </div>
        )}
      </div>

      {!hasQuery ? (
        <StateBlock title="Nhập từ khoá để tìm pin, người dùng và board." />
      ) : tab === 'pin' ? (
        <PinResults query={submitted} />
      ) : tab === 'user' ? (
        <UserResults query={submitted} />
      ) : (
        <BoardResults query={submitted} />
      )}
    </div>
  );
}

// ─── Tab con ───────────────────────────────────────────────────────────────────

function PinResults({ query }: { query: string }) {
  const router = useRouter();
  const { items, loading, loadingMore, hasNextPage, loadMore, error } = useSearchPins({
    query,
    first: PAGE,
  });
  if (error) return <StateBlock title="Không tải được kết quả" subtitle="Kiểm tra mạng rồi thử lại." />;
  return (
    <>
      <PinGrid
        items={items}
        loading={loading}
        loadingMore={loadingMore}
        hasNextPage={hasNextPage}
        loadMore={loadMore}
        onOpen={(id) => router.push(`/pin/${id}`)}
      />
      {!loading && items.length === 0 && (
        <StateBlock
          title="Không có pin nào khớp"
          subtitle="Thử từ khoá ngắn hơn, hoặc xem tab Người dùng và Board."
        />
      )}
    </>
  );
}

function UserResults({ query }: { query: string }) {
  const { items, loading, loadingMore, hasNextPage, loadMore, error } = useSearchUsers({
    query,
    first: PAGE,
  });
  if (error) return <StateBlock title="Không tải được kết quả" subtitle="Kiểm tra mạng rồi thử lại." />;
  if (loading && items.length === 0) return <LoadingBlock />;
  if (items.length === 0)
    return <StateBlock title="Không tìm thấy người dùng nào" subtitle="Thử tên hoặc @tên đăng nhập khác." />;
  return (
    <div style={{ padding: '0 16px 32px', maxWidth: 640 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((u) => (
          <SearchUserRow key={u.id} user={u} />
        ))}
      </div>
      {hasNextPage && <MoreButton loadingMore={loadingMore} onClick={loadMore} />}
    </div>
  );
}

function BoardResults({ query }: { query: string }) {
  const router = useRouter();
  const { items, loading, loadingMore, hasNextPage, loadMore, error } = useSearchBoards({
    query,
    first: PAGE,
  });
  if (error) return <StateBlock title="Không tải được kết quả" subtitle="Kiểm tra mạng rồi thử lại." />;
  if (loading && items.length === 0) return <LoadingBlock />;
  if (items.length === 0)
    return (
      <StateBlock
        title="Không có board nào khớp"
        subtitle="Thử từ khoá ngắn hơn, hoặc xem tab Pin và Người dùng."
      />
    );
  return (
    <div style={{ padding: '0 16px 32px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 18,
        }}
      >
        {items.map((b) => (
          <SearchBoardCard key={b.id} board={b} onOpen={() => router.push(`/board/${b.id}`)} />
        ))}
      </div>
      {hasNextPage && <MoreButton loadingMore={loadingMore} onClick={loadMore} />}
    </div>
  );
}

// ─── Hàng người dùng (nút Theo dõi thật) ────────────────────────────────────────

type SearchUser = ReturnType<typeof useSearchUsers>['items'][number];

function SearchUserRow({ user }: { user: SearchUser }) {
  const router = useRouter();
  const { status } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const toast = useToast();
  const [followM] = useMutation(FollowDocument);
  const [unfollowM] = useMutation(UnfollowDocument);
  const [following, setFollowing] = useState(!!user.isFollowedByViewer);
  const [busy, setBusy] = useState(false);

  const dispName = user.name ?? user.username ?? '';

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (status !== 'authenticated') {
      openAuthPrompt('theo dõi người này');
      return;
    }
    if (busy) return;
    setBusy(true);
    const next = !following;
    setFollowing(next); // optimistic
    try {
      if (next) await followM({ variables: { userId: user.id } });
      else await unfollowM({ variables: { userId: user.id } });
    } catch {
      setFollowing(!next);
      toast({
        message: next ? 'Không theo dõi được, thử lại sau.' : 'Không bỏ theo dõi được, thử lại sau.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/@${user.username ?? ''}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(`/@${user.username ?? ''}`);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 14,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        cursor: 'pointer',
      }}
    >
      <RowAvatar name={dispName} url={user.avatarUrl} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 14,
            color: 'var(--color-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {dispName}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>@{user.username}</div>
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        style={
          following
            ? {
                padding: '9px 16px',
                borderRadius: 999,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-foreground)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                flex: 'none',
              }
            : {
                padding: '9px 16px',
                borderRadius: 999,
                border: 'none',
                background: 'var(--color-primary)',
                color: 'var(--color-primary-foreground)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                flex: 'none',
              }
        }
      >
        {following ? 'Đang theo dõi' : 'Theo dõi'}
      </button>
    </div>
  );
}

// ─── Thẻ board (1 ảnh bìa) ──────────────────────────────────────────────────────

type SearchBoard = ReturnType<typeof useSearchBoards>['items'][number];

function SearchBoardCard({ board, onOpen }: { board: SearchBoard; onOpen: () => void }) {
  const cover = board.coverPin?.thumbnailUrl ?? board.coverPin?.imageUrl ?? null;
  return (
    <button
      type="button"
      onClick={onOpen}
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
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>
      <div
        style={{
          fontWeight: 700,
          fontSize: 14,
          color: 'var(--color-foreground)',
          marginTop: 9,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {board.name}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 2 }}>
        {formatCount(board.pinCount ?? 0)} pin · @{board.user?.username}
      </div>
    </button>
  );
}

// ─── Bits dùng lại ──────────────────────────────────────────────────────────────

function TabPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '7px 16px',
        borderRadius: 999,
        border: 'none',
        background: active ? 'var(--color-background)' : 'transparent',
        color: active ? 'var(--color-foreground)' : 'var(--color-muted)',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function StateBlock({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      role="status"
      style={{ padding: '56px 20px', textAlign: 'center', color: 'var(--color-muted)' }}
    >
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--color-foreground)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.6 }}>{subtitle}</div>}
    </div>
  );
}

function LoadingBlock() {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-muted)', fontSize: 14 }}>
      Đang tải…
    </div>
  );
}

function MoreButton({ loadingMore, onClick }: { loadingMore: boolean; onClick: () => void }) {
  const style: CSSProperties = {
    marginTop: 10,
    width: '100%',
    padding: 10,
    borderRadius: 12,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-muted)',
    fontSize: 13,
    cursor: 'pointer',
  };
  return (
    <button type="button" onClick={onClick} disabled={loadingMore} style={style}>
      {loadingMore ? 'Đang tải…' : 'Xem thêm'}
    </button>
  );
}

function RowAvatar({ name, url }: { name?: string | null; url?: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
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
