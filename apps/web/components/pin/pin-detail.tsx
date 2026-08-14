'use client';

import { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { PinDocument, type PinQuery, type PinQueryVariables } from '@/lib/gql/graphql';
import { toReadState } from '@/lib/errors/map-error';
import { REACTION_ORDER, REACTION_EMOJI, REACTION_LABEL } from '@/lib/reactions';
import { PinComments } from './pin-comments';

/**
 * FE-4 — Body chi tiết pin, dùng chung cho bản modal và bản trang đầy đủ.
 *
 * MỘT component + `variant` — không tách 2 component, cũng KHÔNG ép hai bản
 * giống hệt nhau. `PROMPT_FE4.md` §3.4 liệt kê 8 dòng khác biệt: thứ tự khối
 * đảo (modal: h1 → mô tả → cảm xúc · page: cảm xúc → h1 → mô tả), cỡ chữ khác
 * (h1 24 vs 27, mô tả 14 vs 14.5), avatar tác giả khác (38 vs 40), và 4 khối
 * CHỈ có ở page: dòng phụ tác giả · dải tag · ô soạn bình luận · nút Chia sẻ.
 *
 * ⚠️ ĐỌC + ĐIỀU HƯỚNG. Không gọi mutation nào (PROMPT_FE4.md §1). Nút Lưu,
 * hàng cảm xúc, nút Theo dõi, ô soạn — dựng đủ hình + đọc đúng trạng thái từ
 * API, nhưng KHÔNG mutate. Ràng buộc là "màn đăng nhập là FE-5, chưa có" ⇒
 * viết mutation bây giờ = code chạy mà không nghiệm thu được.
 *
 * Pill board (`{{ detailBoard }}`) — API không có dữ liệu này (§4.2). Render
 * trung tính "Lưu vào bảng ▾", `disabled`. BoardPicker là FE-7.
 *
 * Ảnh: `largeUrl ?? mediumUrl ?? imageUrl` — 3 URL responsive nullable ở dev
 * (bẫy 8). Vẫn phải xuống được `imageUrl` (non-null theo SDL).
 *
 * next/image bị bỏ (bẫy 6) — `next.config.ts` chưa khai `remotePatterns`, ảnh
 * seed đến từ `images.unsplash.com`.
 */

type Variant = 'modal' | 'page';

function pickDetailImageUrl(pin: NonNullable<PinQuery['pin']>): string {
  return pin.largeUrl ?? pin.mediumUrl ?? pin.imageUrl;
}

function initialOf(name: string | null | undefined, username: string | null | undefined): string {
  const source = (name || username || '?').trim();
  return source.charAt(0).toUpperCase() || '?';
}

function formatFollowerCount(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.floor(n);
  if (rounded < 1000) return `${rounded} người theo dõi`;
  if (rounded < 1_000_000) return `${(rounded / 1000).toFixed(rounded < 10_000 ? 1 : 0)}K người theo dõi`;
  return `${(rounded / 1_000_000).toFixed(1)}M người theo dõi`;
}

type Props = {
  pinId: string;
  variant: Variant;
  /** Chỉ variant='modal' truyền — trang đầy đủ dùng "← Quay lại lưới" riêng. */
  onClose?: () => void;
};

export function PinDetail({ pinId, variant, onClose }: Props) {
  const query = useQuery<PinQuery, PinQueryVariables>(PinDocument, {
    variables: { id: pinId },
  });
  // Apollo v4 `Result` có `error?: unknown`; toReadState nhận `error: unknown`
  // (required). Chuyển shape tường minh — đừng spread `query` vì các field
  // khác sẽ chèn vào và làm lệch signature.
  const state = toReadState({
    data: query.data,
    loading: query.loading,
    error: query.error,
  });

  if (state.phase === 'loading') {
    return (
      <div
        role="status"
        aria-label="Đang tải pin"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 200,
          color: 'var(--color-muted)',
          fontSize: 13.5,
        }}
      >
        Đang tải…
      </div>
    );
  }

  if (state.phase === 'error') {
    const message =
      state.state.kind === 'not-found'
        ? 'Không tìm thấy pin này.'
        : state.state.kind === 'network'
          ? 'Không kết nối được máy chủ.'
          : 'Không tải được pin.';
    return (
      <div
        role="alert"
        data-error-kind={state.state.kind}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          gap: 8,
          padding: 24,
          textAlign: 'center',
          color: 'var(--color-muted)',
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--color-foreground)' }}>{message}</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13.5,
            }}
          >
            Đóng
          </button>
        )}
      </div>
    );
  }

  const pin = state.data.pin;
  if (!pin) {
    return (
      <div
        role="alert"
        data-error-kind="not-found"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          color: 'var(--color-muted)',
          fontSize: 14,
          padding: 24,
        }}
      >
        Không tìm thấy pin này.
      </div>
    );
  }

  return <PinDetailContent pin={pin} variant={variant} onClose={onClose} />;
}

function PinDetailContent({
  pin,
  variant,
  onClose,
}: {
  pin: NonNullable<PinQuery['pin']>;
  variant: Variant;
  onClose?: () => void;
}) {
  const isModal = variant === 'modal';
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const [optimisticFollow, setOptimisticFollow] = useState<boolean | null>(null);
  const [optimisticReaction, setOptimisticReaction] = useState<string | null>(null);

  const isSaved = optimisticSaved ?? pin.isSavedByViewer ?? false;
  const isFollowed = optimisticFollow ?? pin.creator.isFollowedByViewer ?? false;
  const currentReaction = optimisticReaction ?? pin.viewerReaction ?? null;
  const imgUrl = pickDetailImageUrl(pin);
  const title = pin.title || pin.description || 'Pin không tiêu đề';
  const description = pin.description ?? '';
  const followerLabel = formatFollowerCount(pin.creator.followerCount);
  const authorName = pin.creator.name || pin.creator.username || 'Người dùng';

  const headerRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: isModal ? 18 : 20,
      }}
    >
      {isModal ? (
        <>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ×
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>
            ESC để đóng · bấm nền để đóng
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            aria-label="Thêm tuỳ chọn"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ⋯
          </button>
          <button
            type="button"
            style={{
              padding: '10px 16px',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13.5,
            }}
          >
            Chia sẻ
          </button>
        </>
      )}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        disabled
        aria-label="Chọn bảng để lưu (BoardPicker sẽ dựng ở FE-7)"
        title="BoardPicker sẽ dựng ở FE-7"
        style={{
          padding: isModal ? '9px 16px' : '10px 18px',
          borderRadius: 'var(--radius-button)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface-muted)',
          color: 'var(--color-muted)',
          fontWeight: 600,
          fontSize: isModal ? 13 : 13.5,
          cursor: 'not-allowed',
          opacity: 0.75,
        }}
      >
        Lưu vào bảng ▾
      </button>
      <button
        type="button"
        aria-pressed={isSaved}
        onClick={() => setOptimisticSaved(!isSaved)}
        style={{
          padding: isModal ? '9px 16px' : '10px 18px',
          borderRadius: 'var(--radius-button)',
          border: 'none',
          fontWeight: 700,
          fontSize: isModal ? 13 : 13.5,
          cursor: 'pointer',
          background: isSaved ? 'var(--color-foreground)' : 'var(--color-primary)',
          color: isSaved ? 'var(--color-background)' : 'var(--color-primary-foreground)',
        }}
      >
        {isSaved ? 'Đã lưu' : 'Lưu'}
      </button>
    </div>
  );

  const reactionsRow = (
    <div
      role="group"
      aria-label="Chọn cảm xúc"
      style={{
        display: 'flex',
        gap: 6,
        marginBottom: 18,
        flexWrap: 'wrap',
      }}
    >
      {REACTION_ORDER.map((r) => {
        const active = currentReaction === r;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={active}
            title={REACTION_LABEL[r]}
            onClick={() => setOptimisticReaction(active ? null : r)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 'var(--radius-button)',
              border: active ? '1px solid var(--color-primary-strong)' : '1px solid var(--color-border)',
              background: active ? 'var(--color-primary-soft)' : 'var(--color-surface)',
              color: 'var(--color-foreground)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
              {REACTION_EMOJI[r]}
            </span>
            <span>{REACTION_LABEL[r]}</span>
          </button>
        );
      })}
    </div>
  );

  const h1 = (
    <h1
      style={{
        fontFamily: 'var(--font-display), var(--font-be-vietnam-pro), sans-serif',
        fontSize: isModal ? 24 : 27,
        margin: '0 0 10px',
        lineHeight: 1.25,
        color: 'var(--color-foreground)',
      }}
    >
      {title}
    </h1>
  );

  const descP = description ? (
    <p
      style={{
        fontSize: isModal ? 14 : 14.5,
        lineHeight: 1.65,
        color: 'var(--color-muted)',
        margin: '0 0 18px',
      }}
    >
      {description}
    </p>
  ) : null;

  const tagsRow =
    !isModal && pin.tags.length > 0 ? (
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 7,
          marginBottom: 20,
        }}
      >
        {pin.tags.map((t) => (
          <span
            key={t.id}
            style={{
              padding: '5px 11px',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-surface-muted)',
              color: 'var(--color-muted)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            #{t.name}
          </span>
        ))}
      </div>
    ) : null;

  const authorRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '14px 0',
        borderTop: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {pin.creator.avatarUrl ? (
        <img
          src={pin.creator.avatarUrl}
          alt=""
          style={{
            width: isModal ? 38 : 40,
            height: isModal ? 38 : 40,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: isModal ? 38 : 40,
            height: isModal ? 38 : 40,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
          }}
        >
          {initialOf(pin.creator.name, pin.creator.username)}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: isModal ? 13.5 : 14,
            color: 'var(--color-foreground)',
          }}
        >
          {authorName}
        </div>
        {!isModal && followerLabel && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{followerLabel}</div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        aria-pressed={isFollowed}
        onClick={() => setOptimisticFollow(!isFollowed)}
        style={{
          padding: isModal ? '8px 16px' : '9px 18px',
          borderRadius: 'var(--radius-button)',
          border: isFollowed ? '1px solid var(--color-border)' : 'none',
          background: isFollowed ? 'var(--color-surface)' : 'var(--color-foreground)',
          color: isFollowed ? 'var(--color-foreground)' : 'var(--color-background)',
          fontWeight: 700,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        {isFollowed ? 'Đang theo dõi' : 'Theo dõi'}
      </button>
    </div>
  );

  const rightColumn = (
    <div
      style={
        isModal
          ? { padding: '26px 28px', overflowY: 'auto', maxHeight: '82vh' }
          : { padding: '26px 28px' }
      }
    >
      {headerRow}

      {isModal ? (
        <>
          {h1}
          {descP}
          {reactionsRow}
        </>
      ) : (
        <>
          {reactionsRow}
          {h1}
          {descP}
          {tagsRow}
        </>
      )}

      {authorRow}

      <div style={{ paddingTop: 16 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: isModal ? 14 : 14.5,
            marginBottom: 12,
            color: 'var(--color-foreground)',
          }}
        >
          Bình luận
        </div>
        <PinComments pinId={pin.id} variant={variant} />
      </div>

      {isModal && (
        <div style={{ marginTop: 18 }}>
          <a
            href={`/pin/${pin.id}`}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--color-primary-strong)',
              fontSize: 12.5,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Mở trang đầy đủ (F5 / link trực tiếp) →
          </a>
        </div>
      )}
    </div>
  );

  const imageColumn = (
    <div
      style={{
        background: 'var(--color-surface-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
      }}
    >
      <img
        src={imgUrl}
        alt={title}
        style={{
          width: '100%',
          height: '100%',
          maxHeight: isModal ? '82vh' : 'none',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  );

  return (
    <div
      className="pin-detail-frame"
      data-variant={variant}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        background: 'var(--color-surface)',
        borderRadius: isModal ? 26 : 24,
        overflow: 'hidden',
        border: isModal ? 'none' : '1px solid var(--color-border)',
        boxShadow: isModal ? 'var(--shadow-modal)' : 'var(--shadow-card)',
        width: '100%',
        maxHeight: isModal ? '100%' : 'none',
      }}
    >
      {imageColumn}
      {rightColumn}
    </div>
  );
}
