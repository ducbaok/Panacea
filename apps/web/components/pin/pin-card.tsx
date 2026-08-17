'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation } from '@apollo/client/react';
import {
  type ReactionType,
  SavePinDocument,
  type SavePinMutation,
  type SavePinMutationVariables,
  UnsavePinDocument,
  type UnsavePinMutation,
  type UnsavePinMutationVariables,
} from '@/lib/gql/graphql';
import { REACTION_EMOJI } from '@/lib/reactions';
import { useAuthPrompt } from '@/components/auth/auth-prompt';
import { useToast } from '@/components/ui/toast';

/**
 * FE-3 — Thẻ pin (khung + 6 trạng thái §3.3 của brief).
 *
 * Kích thước thẻ TẤT ĐỊNH sau lần render đầu (§4.4 ràng buộc 1):
 *   • Ảnh: aspect-ratio = imageWidth / imageHeight (dữ liệu bắt buộc non-null
 *     ở SDL — mọi Pin đều có sẵn tỉ lệ khung trước khi ảnh về).
 *   • Khối chữ: FIXED HEIGHT = 67px = 9 (padding-top) + 38 (title 2 dòng ·
 *     14×1.35≈19) + 3 (gap) + 17 (subtitle 1 dòng · 12×1.35≈17). Đóng cứng
 *     bằng `height` + `overflow:hidden`, tuyệt đối không dùng `min-height`.
 *
 * Vì sao đóng cứng: masonry của PinGrid tính vị trí bằng số học từ chiều cao
 * hằng số. Nếu height thẻ phụ thuộc nội dung (title dài, subtitle wrap…) ⇒
 * ô tính ra một đằng, DOM chiếm một nẻo ⇒ đè thẻ dưới. §4.4 ràng buộc 1 và
 * đối chứng âm ở §5 phép 5 tồn tại vì lỗi này.
 *
 * Ảnh: fallback ba bậc `thumbnailUrl ?? mediumUrl ?? imageUrl` — 3 URL đầu
 * NULLABLE ở SDL và pipeline dev không điền, phải luôn xuống được `imageUrl`.
 * Bẫy 3 của brief §6 (khớp Bảy cái bẫy §4.3 của PLAN_FRONTEND.md).
 *
 * next/image bị bỏ ở FE-3 vì `next.config.ts` chưa khai `remotePatterns` (bẫy
 * 2 của brief). Sẽ mở khi HT chốt hosts ảnh.
 *
 * Nút Lưu ở FE-3 CHỈ là trạng thái hình ảnh:
 *   • Đọc `isSavedByViewer` làm mặc định.
 *   • Bấm ⇒ đổi cờ optimistic nội bộ; KHÔNG gọi mutation (FE-7 sẽ nối
 *     savePin/unsavePin + BoardPicker).
 *
 * onOpen là prop rỗng có kiểu; FE-4 sẽ cắm điều hướng (modal @modal/(.)pin/[id]
 * hoặc trang /pin/[id]). Đừng router.push tạm rồi để đó — sẽ khớp lệch với QĐ-2.
 */

export const TEXT_BLOCK_HEIGHT = 67;

export type PinCardItem = {
  id: string;
  title?: string | null;
  description?: string | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  mediumUrl?: string | null;
  imageWidth: number;
  imageHeight: number;
  isSavedByViewer?: boolean | null;
  viewerReaction?: ReactionType | null;
  creator: {
    id: string;
    name?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
};

/**
 * Chiều cao thẻ = ảnh (tính theo tỉ lệ + bề rộng cột) + khối chữ CỐ ĐỊNH.
 * Dùng chung bởi PinGrid; xuất ra để PinGrid không phải đoán lại công thức.
 */
export function cardHeight(
  item: Pick<PinCardItem, 'imageWidth' | 'imageHeight'>,
  columnWidth: number,
): number {
  const ratio = item.imageHeight / item.imageWidth;
  return columnWidth * ratio + TEXT_BLOCK_HEIGHT;
}

function pickImageUrl(item: PinCardItem): string {
  return item.thumbnailUrl ?? item.mediumUrl ?? item.imageUrl;
}

/**
 * Chọn cặp tông placeholder ổn định theo id. Mockup dùng `pin.id % 2` — không
 * dịch được sang cuid, và `Math.random()` sẽ lệch hydration (bẫy 11 §6). Chọn
 * bằng mã ASCII ký tự cuối id: chẵn/lẻ ⇒ a1/b1 hoặc a2/b2.
 */
function pickPlaceholderTint(id: string): { a: string; b: string } {
  const lastCode = id.charCodeAt(id.length - 1);
  if (lastCode % 2 === 0) {
    return { a: 'var(--color-placeholder-a1)', b: 'var(--color-placeholder-b1)' };
  }
  return { a: 'var(--color-placeholder-a2)', b: 'var(--color-placeholder-b2)' };
}

type Props = {
  item: PinCardItem;
  columnWidth: number;
  onOpen?: (id: string) => void;
  /**
   * FE-10 — chỗ cắm overlay THEO NGỮ CẢNH, render bên trong vỏ ảnh (vỏ đã
   * `position:relative`, nên node truyền vào tự định vị bằng `position:absolute`).
   *
   * Vì sao là prop chung chứ không phải "nút đặt làm bìa": menu ⋯ "Đặt làm bìa"
   * + badge "Ảnh bìa" chỉ có nghĩa TRONG một board cụ thể (cần boardId, cần
   * coverPinId, cần vai trò EDITOR trên board đó). Nhồi vào PinCard là buộc mọi
   * màn dùng lưới phải biết về board. Chủ gọi (board-view) giữ toàn bộ logic đó.
   */
  overlay?: React.ReactNode;
};

export function PinCard({ item, columnWidth, onOpen, overlay }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageStatus, setImageStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [optimisticSaved, setOptimisticSaved] = useState<boolean | null>(null);
  const { status: sessionStatus } = useSession();
  const { openAuthPrompt } = useAuthPrompt();
  const toast = useToast();
  const [savePin] = useMutation<SavePinMutation, SavePinMutationVariables>(SavePinDocument);
  const [unsavePin] = useMutation<UnsavePinMutation, UnsavePinMutationVariables>(UnsavePinDocument);
  const [saveBusy, setSaveBusy] = useState(false);

  const isSaved = optimisticSaved ?? item.isSavedByViewer ?? false;
  const url = pickImageUrl(item);
  const tint = pickPlaceholderTint(item.id);
  const title = item.title || item.description || '';
  const subtitle = item.creator.name || item.creator.username || '';

  // Cache-hit race: ảnh đã complete TRƯỚC khi effect subscribe onLoad/onError.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      if (img.naturalWidth === 0) setImageStatus('error');
      else setImageStatus('loaded');
    }
  }, []);

  const handleOpen = () => onOpen?.(item.id);

  // Lưu lại sau khi Hoàn tác — im lặng, không toast lồng.
  const resaveQuiet = async () => {
    setOptimisticSaved(true);
    try {
      await savePin({ variables: { input: { pinId: item.id } } });
    } catch {
      setOptimisticSaved(false);
    }
  };

  // Lưu nhanh: toggle lưu/bỏ-lưu vào HỒ SƠ (boardId null) — KHÔNG mở picker (Q3).
  const toggleSave = async () => {
    if (sessionStatus === 'unauthenticated') {
      openAuthPrompt('lưu pin này');
      return;
    }
    if (saveBusy) return;
    const next = !isSaved;
    setOptimisticSaved(next); // optimistic
    setSaveBusy(true);
    try {
      if (next) {
        // savePin trả pin{ id isSavedByViewer } ⇒ Apollo cache tự cập nhật.
        await savePin({ variables: { input: { pinId: item.id } } });
      } else {
        // Bỏ lưu hồ sơ: KHÔNG truyền boardId (truyền vào đòi quyền EDITOR — §8.10).
        await unsavePin({
          variables: { pinId: item.id },
          update: (cache) =>
            cache.modify({
              id: cache.identify({ __typename: 'Pin', id: item.id }),
              fields: { isSavedByViewer: () => false },
            }),
        });
        toast({
          message: 'Đã bỏ lưu',
          action: { label: 'Hoàn tác', onClick: () => void resaveQuiet() },
        });
      }
    } catch {
      setOptimisticSaved(!next); // rollback
      toast({ message: 'Không lưu được, thử lại sau.' });
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <article
      className="group"
      onClick={handleOpen}
      style={{
        width: '100%',
        cursor: 'pointer',
      }}
    >
      {/* Vỏ ảnh — aspect-ratio quyết định chiều cao, KHÔNG phụ thuộc tải xong */}
      <div
        style={{
          position: 'relative',
          borderRadius: 'var(--radius-card)',
          overflow: 'hidden',
          background: 'var(--color-surface-muted)',
          boxShadow: 'var(--shadow-card)',
          aspectRatio: `${item.imageWidth} / ${item.imageHeight}`,
        }}
      >
        {/* Vân placeholder — hiện khi loading hoặc error, ẩn khi loaded */}
        {imageStatus !== 'loaded' && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: `repeating-linear-gradient(135deg, ${tint.a} 0 14px, ${tint.b} 14px 28px)`,
            }}
          />
        )}

        {/* Ảnh — chỉ render khi chưa error để giải phóng request/handle */}
        {imageStatus !== 'error' && (
          <img
            ref={imgRef}
            src={url}
            alt={title}
            loading="lazy"
            onLoad={() => setImageStatus('loaded')}
            onError={() => setImageStatus('error')}
            style={{
              display: imageStatus === 'loaded' ? 'block' : 'none',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        )}

        {/* Khung thay thế khi ảnh lỗi (trạng thái 4) — giữ đúng ô, không vỡ */}
        {imageStatus === 'error' && (
          <div
            role="img"
            aria-label="Không tải được ảnh"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-muted)',
              fontSize: '12px',
              fontWeight: 500,
              textAlign: 'center',
              padding: '0 12px',
            }}
          >
            Không tải được ảnh
          </div>
        )}

        {/* Nút Lưu — trạng thái 2 (hover) + trạng thái 5 (đã lưu) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void toggleSave();
          }}
          aria-pressed={isSaved}
          className={`transition-opacity ${isSaved ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          style={{
            position: 'absolute',
            top: '9px',
            right: '9px',
            padding: '8px 15px',
            borderRadius: 'var(--radius-button)',
            border: 'none',
            fontWeight: 700,
            fontSize: '12.5px',
            cursor: 'pointer',
            background: isSaved ? 'var(--color-foreground)' : 'var(--color-primary)',
            color: isSaved ? 'var(--color-background)' : 'var(--color-primary-foreground)',
          }}
        >
          {isSaved ? 'Đã lưu' : 'Lưu'}
        </button>

        {/* Menu ⋯ — chỉ hiện khi hover (trạng thái 2). FE-3 để trống hành vi */}
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label="Thêm tuỳ chọn"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            position: 'absolute',
            bottom: '9px',
            right: '9px',
            width: '32px',
            height: '32px',
            padding: 0,
            border: 'none',
            borderRadius: 'var(--radius-button)',
            background: 'var(--color-surface)',
            color: 'var(--color-foreground)',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '18px',
            lineHeight: 1,
          }}
        >
          ⋯
        </button>

        {/* Chỉ báo cảm xúc — trạng thái 6 (đã thả cảm xúc) */}
        {item.viewerReaction && (
          <div
            aria-label={`Đã thả cảm xúc ${item.viewerReaction}`}
            style={{
              position: 'absolute',
              bottom: '9px',
              left: '9px',
              padding: '4px 10px',
              borderRadius: 'var(--radius-button)',
              background: 'var(--color-surface)',
              color: 'var(--color-foreground)',
              fontSize: '14px',
              fontWeight: 600,
              boxShadow: 'var(--shadow-card)',
            }}
          >
            {REACTION_EMOJI[item.viewerReaction]}
          </div>
        )}

        {/* Overlay theo ngữ cảnh (FE-10): board-view cắm badge "Ảnh bìa" + menu
            ⋯ "Đặt làm bìa" vào đây. Đặt CUỐI để nằm trên ảnh và các chỉ báo. */}
        {overlay}
      </div>

      {/* Khối chữ — height CỐ ĐỊNH, không đổi theo nội dung (§4.4.1) */}
      <div
        style={{
          height: `${TEXT_BLOCK_HEIGHT}px`,
          padding: '9px 4px 0',
          overflow: 'hidden',
        }}
      >
        <h3
          style={{
            fontWeight: 600,
            fontSize: '14px',
            lineHeight: 1.35,
            color: 'var(--color-foreground)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            margin: 0,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: '12px',
            lineHeight: 1.35,
            color: 'var(--color-muted)',
            marginTop: '3px',
            marginBottom: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {subtitle}
        </p>
      </div>
    </article>
  );
}
