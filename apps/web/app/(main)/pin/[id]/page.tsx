import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { PinDetail } from '@/components/pin/pin-detail';
import { BackToGridLink } from './back-link';
import { fetchPinForServer, type ServerPin } from './fetch-pin-server';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';

/**
 * FE-4 — Trang chi tiết pin đầy đủ `/pin/[id]`.
 *
 * ⚠️ Ba chi tiết thuộc bản Next 16.2.6 khác kiến thức cũ (§5.2 PROMPT_FE4.md):
 *   • `params` là **Promise**. `params.id` cho `undefined`, không báo lỗi.
 *   • `generateMetadata` cũng nhận `params: Promise`.
 *   • `notFound()` từ `next/navigation` — trả HTTP 404 chuẩn, render trang
 *     `not-found.tsx` gần nhất.
 *
 * Metadata SEO: `generateMetadata` fetch THẲNG tới API bằng `fetch()`, KHÔNG
 * qua Apollo (§6 PROMPT_FE4.md — tầng dữ liệu là client-only theo QĐ FE-0).
 * Metadata là chuỗi tĩnh — không cần cache chuẩn hoá, không cần hook. KHÔNG
 * kéo Apollo lên server để giải quyết — đó là đảo ngược FE-0.
 *
 * Bản modal `(.)pin/[id]` KHÔNG cần metadata — nó không bao giờ là điểm vào
 * hard-navigation (§6 chi tiết 3).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const locale = await getLocale();
  // Cùng token với `PinPage` bên dưới — nếu hai lượt hỏi backend bằng hai danh
  // tính khác nhau thì trang render ra được mà thẻ <title> lại ghi "Pin không
  // tồn tại", một kiểu sai chỉ lộ ra khi chia sẻ link.
  const session = await auth();
  const { pin } = await fetchPinForServer(id, session?.accessToken);
  if (!pin) {
    return { title: translate(locale, 'pin.notFoundMeta') };
  }
  return buildMetadata(pin, locale);
}

export default async function PinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 🔴 Token BẮT BUỘC ở đây — thiếu nó, chính chủ mở thẳng URL pin non-PUBLIC
  // của mình cũng ăn 404 (lý do đầy đủ ở đầu `fetch-pin-server.ts`).
  const session = await auth();
  const { pin, error } = await fetchPinForServer(id, session?.accessToken);
  // Explicit 'not-found' ⇒ 404 chuẩn. Nếu lỗi mạng (API tắt), giao lại cho
  // client PinDetail xử lý (có thể recover khi API bật lại) — không notFound.
  if (error === 'not-found' || (!pin && error === null)) {
    notFound();
  }

  return (
    <div
      style={{
        padding: '24px 16px 40px',
        maxWidth: 1080,
        margin: '0 auto',
      }}
    >
      <BackToGridLink />
      <PinDetail pinId={id} variant="page" />
    </div>
  );
}

function buildMetadata(pin: ServerPin, locale: Locale): Metadata {
  const rawTitle =
    pin.title?.trim() || pin.description?.trim().slice(0, 60) || translate(locale, 'pin.untitled');
  const description =
    pin.description?.trim() ||
    translate(locale, 'pin.metaByline', {
      name: pin.creator?.name || pin.creator?.username || translate(locale, 'pin.metaSomeone'),
    });
  const image = pin.largeUrl ?? pin.mediumUrl ?? pin.imageUrl;
  return {
    title: `${rawTitle} · Panacea`,
    description,
    openGraph: {
      title: rawTitle,
      description,
      images: image ? [{ url: image }] : undefined,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: rawTitle,
      description,
      images: image ? [image] : undefined,
    },
  };
}
