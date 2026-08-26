// Bước 78 — XH-VIDEO: pin video ngắn 10/15/30s (26/08/2026)
// (`docs/spec-man-xahoi-capture.md` §"Riêng phần QUAY VIDEO")
//
// PHẠM VI: đúng phần MÁY CHỦ của tính năng — cửa upload (whitelist MIME, trần
// theo LOẠI) và `createPin` (cặp url+thời lượng, trần thời lượng, whitelist
// domain). Khâu QUAY nằm ở `MediaRecorder` trong trình duyệt và không có bề mặt
// HTTP nào để gọi, nên nó KHÔNG ở đây — nó được đo trên trình duyệt. Ghi rõ ra
// để không ai đọc "bước 78 xanh" thành "quay video chạy được".
//
// 🔴 PHÉP QUAN TRỌNG NHẤT LÀ MỤC 2c — ẢNH 12MB PHẢI BỊ TỪ CHỐI. Để nhận video
// 30MB, `limits.fileSize` của multer buộc phải nới lên 30MB cho MỌI file; trần
// 10MB của ảnh từ đó trở đi do handler tự siết lại. Nếu ai đó gỡ đoạn siết ấy
// thì KHÔNG có gì đỏ ngoài phép này: mọi phép ảnh khác vẫn xanh, chỉ là cửa đã
// mở rộng gấp ba cho ảnh mà không ai biết.
//
// ⚠️ MIME KÈM THAM SỐ CODEC (mục 2b) là bẫy thật, không phải phép cho đủ:
// `MediaRecorder` đặt `Blob.type = 'video/webm;codecs="vp9,opus"'`, và tra
// thẳng chuỗi đó vào whitelist thì trượt 100% — tức là tính năng hỏng toàn
// phần đúng ở đường đi CHÍNH.
//
// ⚠️ DỌN Ở ĐẦU BƯỚC (luật đã trả giá 5 lần). Trạng thái sống lâu ở đây:
//   · `Pin` tiêu đề `xh78*` — pin của lần chạy trước lọt vào exploreFeed của
//     bước 80/90;
//   · `pincreate:<userId>` — TTL 60s. Bước này tạo ~2 pin nên không chạm trần
//     10 pin/phút, NHƯNG nó dùng tài khoản dùng-một-lần riêng chứ không tiêu
//     quota của bao, đúng luật bước 77 đã ghi: bao là tiền đề cứng của hàng
//     chục phép khác.
//
// VỊ TRÍ 78: sau 77 (77 dọn khoá `pincreate` của chính nó), trước 80.

import { createRequire } from 'node:module';
import { readApiEnv, API } from '../lib/client.mjs';

const require = createRequire(import.meta.url);

const T = (s) => `xh78 ${s}`;
const POSTER = 'http://localhost:4000/uploads/xh78-poster.jpg';
const EVIL = 'https://evil.example.com/xh78.webm';

const M_CREATE = `mutation($i:CreatePinInput!){ createPin(input:$i){ id title videoUrl videoDurationMs } }`;
const Q_PIN = `query($id:ID!){ pin(id:$id){ id imageUrl videoUrl videoDurationMs } }`;

/** Trần phải khớp `MAX_VIDEO_MS` ở `apps/api/src/pins/pins.service.ts`. */
const MAX_VIDEO_MS = 32_000;

/**
 * Dựng một `Blob` đúng KÍCH THƯỚC và đúng MIME, nội dung là byte rác.
 *
 * Cố ý KHÔNG dựng file webm hợp lệ: cửa upload không giải mã nội dung (và
 * không nên — xem docblock `uploads.controller.ts`), nên một file "thật" chỉ
 * làm phép kiểm tra nặng hơn mà không đo thêm được gì. Việc file phát được hay
 * không là chuyện của trình duyệt, đo ở tầng khác.
 */
const blobOf = (bytes, type) => new Blob([new Uint8Array(bytes)], { type });

const formOf = (blob, name) => {
  const fd = new FormData();
  fd.append('file', blob, name);
  return fd;
};

export default async function (h) {
  const { rest, gql, silent, assert, rec, state } = h;
  h.setGroup('GQL/video');

  // ─── Prisma CHỈ để dọn (không phải bằng chứng) ─────────────────────────────
  let prisma;
  try {
    const { PrismaClient } = require('../../../packages/database/src/client');
    const url = readApiEnv('DATABASE_URL');
    if (!url) {
      rec('setup: DATABASE_URL', 'FAIL', 'không đọc được từ env lẫn apps/api/.env');
      return false;
    }
    prisma = new PrismaClient({ datasources: { db: { url } } });
  } catch (e) {
    rec('setup: PrismaClient', 'FAIL', String(e.message).slice(0, 150));
    return false;
  }

  let probeToken = null;

  try {
    // ═══ DỌN Ở ĐẦU BƯỚC ═════════════════════════════════════════════════════
    const wiped = await prisma.pin.deleteMany({ where: { title: { startsWith: 'xh78' } } });
    rec('dọn state sống lâu Ở ĐẦU BƯỚC (pin xh78*)', 'OK', `xoá ${wiped.count} pin`);

    // ═══ 0. Tài khoản dùng-một-lần ══════════════════════════════════════════
    {
      const email = `video_${state.uniq}@example.com`;
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Video probe' }),
      });
      const body = await r.json().catch(() => null);
      probeToken = body?.accessToken ?? null;
      // Tên bản ghi KHÔNG chứa email thật (đổi mỗi lần chạy): mốc hồi quy đối
      // chiếu `results.json` theo cặp `group::name`.
      assert(
        'đăng ký tài khoản dùng-một-lần video_<uniq>@example.com (KHÔNG tiêu quota tạo pin của bao)',
        Boolean(probeToken),
        probeToken ? 'có accessToken' : 'KHÔNG có accessToken',
      );
      if (!probeToken) return false;
    }

    // ═══ 1. Cửa upload — nhánh ĐI LỌT ═══════════════════════════════════════
    let videoUrl = null;
    {
      const res = await rest(
        'POST /uploads/local nhận `video/webm` (2KB) và trả file đuôi .webm',
        'POST',
        '/uploads/local',
        { token: probeToken, form: formOf(blobOf(2048, 'video/webm'), 'xh78.webm') },
      );
      videoUrl = res?.url ?? null;
      assert(
        'URL trả về có đuôi .webm (đuôi suy TỪ MIME đã whitelist, không từ tên client gửi)',
        typeof videoUrl === 'string' && videoUrl.endsWith('.webm'),
        String(videoUrl).slice(0, 110),
      );
    }

    // ═══ 2. Cửa upload — bốn nhánh BỊ TỪ CHỐI / biên ════════════════════════
    // 2b — MIME kèm tham số codec: đường đi CHÍNH của MediaRecorder.
    {
      const res = await rest(
        'POST /uploads/local nhận MIME kèm tham số codec `video/webm;codecs="vp9,opus"` (đường đi chính của MediaRecorder)',
        'POST',
        '/uploads/local',
        {
          token: probeToken,
          form: formOf(blobOf(2048, 'video/webm;codecs="vp9,opus"'), 'xh78-codecs.webm'),
        },
      );
      assert(
        'MIME kèm codec vẫn ra đuôi .webm (tra whitelist SAU khi cắt tham số)',
        typeof res?.url === 'string' && res.url.endsWith('.webm'),
        String(res?.url).slice(0, 110),
      );
    }

    // 2a — container video ngoài whitelist.
    await rest(
      'POST /uploads/local từ chối `video/quicktime` (ngoài whitelist) — 400 nêu đủ danh sách cho phép',
      'POST',
      '/uploads/local',
      {
        token: probeToken,
        form: formOf(blobOf(2048, 'video/quicktime'), 'xh78.mov'),
        expect: [400],
        match: /Unsupported file type.*video\/webm.*video\/mp4/s,
      },
    );

    // 2c — PHÉP QUAN TRỌNG NHẤT (xem đầu file).
    await rest(
      'POST /uploads/local từ chối ẢNH 12MB — 413 (trần ảnh vẫn 10MB dù multer đã nới lên 30MB cho video)',
      'POST',
      '/uploads/local',
      {
        token: probeToken,
        form: formOf(blobOf(12 * 1024 * 1024, 'image/png'), 'xh78-big.png'),
        expect: [413],
        // ⚠️ Thân phản hồi được `JSON.stringify` lại trước khi so khớp, nên dấu
        // nháy quanh MIME đến đây là `\"` chứ không phải `"`. Viết `for
        // "image/png"` trông đúng mà FAIL với lý do "SAI LÝ DO" — đã dính một
        // lần. Khớp lỏng ở đúng chỗ bị escape, chặt ở con số.
        match: /max 10485760 bytes for .{0,2}image\/png/,
      },
    );

    // 2d — biên TRÊN của video.
    await rest(
      'POST /uploads/local từ chối VIDEO 31MB — 413 (biên trên của trần 30MB)',
      'POST',
      '/uploads/local',
      {
        token: probeToken,
        form: formOf(blobOf(31 * 1024 * 1024, 'video/webm'), 'xh78-big.webm'),
        expect: [413],
      },
    );

    // 2e — nhánh presigned dùng CHUNG whitelist; kiểm bằng thông điệp lỗi của
    // DTO (chạy TRƯỚC khi đụng tới S3, nên không cần credentials AWS).
    await rest(
      'POST /uploads/presigned-url: DTO liệt kê cả video/webm + video/mp4 trong danh sách cho phép',
      'POST',
      '/uploads/presigned-url',
      {
        token: probeToken,
        body: { contentType: 'video/quicktime' },
        expect: [400],
        match: /video\/webm.*video\/mp4/s,
      },
    );

    if (!videoUrl) {
      rec('bỏ phần createPin vì không upload được video', 'FAIL', 'xem phép mục 1');
      return false;
    }

    // ═══ 3. createPin — nhánh HỢP LỆ ════════════════════════════════════════
    let pinId = null;
    {
      const d = await gql(
        'createPin với videoUrl + videoDurationMs tạo được pin video',
        M_CREATE,
        {
          i: {
            imageUrl: POSTER,
            imageWidth: 640,
            imageHeight: 360,
            title: T('ok'),
            videoUrl,
            videoDurationMs: 5693,
          },
        },
        { token: probeToken },
      );
      pinId = d?.createPin?.id ?? null;
      assert(
        'createPin trả lại đúng videoUrl + videoDurationMs vừa gửi',
        d?.createPin?.videoUrl === videoUrl && d?.createPin?.videoDurationMs === 5693,
        `videoUrl=${d?.createPin?.videoUrl ?? 'null'} · ms=${d?.createPin?.videoDurationMs ?? 'null'}`,
      );
    }

    // Đọc lại từ query công khai: ghi được mà đọc không ra thì FE không vẽ được
    // trình phát, và cái sai đó không lộ ở phép trên.
    if (pinId) {
      const d = await gql('query pin trả về hai trường video (FE cần để vẽ badge ▶ + trình phát)', Q_PIN, { id: pinId }, {
        token: probeToken,
      });
      assert(
        'pin đọc lại: videoUrl + videoDurationMs khớp, imageUrl (poster) vẫn còn',
        d?.pin?.videoUrl === videoUrl &&
          d?.pin?.videoDurationMs === 5693 &&
          d?.pin?.imageUrl === POSTER,
        `videoUrl=${d?.pin?.videoUrl ?? 'null'} · ms=${d?.pin?.videoDurationMs ?? 'null'} · imageUrl=${String(d?.pin?.imageUrl).slice(0, 60)}`,
      );
    }

    // ═══ 4. createPin — bốn nhánh BỊ TỪ CHỐI ════════════════════════════════
    const bad = (name, extra, expect) =>
      gql(name, M_CREATE, {
        i: { imageUrl: POSTER, imageWidth: 640, imageHeight: 360, title: T('bad'), ...extra },
      }, { token: probeToken, expect });

    await bad(
      'createPin từ chối NỬA CẶP: có videoUrl, thiếu videoDurationMs',
      { videoUrl },
      /must be provided together/i,
    );
    await bad(
      'createPin từ chối NỬA CẶP ngược lại: có videoDurationMs, thiếu videoUrl (pin ảnh mang thời lượng)',
      { videoDurationMs: 5000 },
      /must be provided together/i,
    );
    await bad(
      `createPin từ chối đoạn dài quá trần (${MAX_VIDEO_MS + 13_000}ms > ${MAX_VIDEO_MS}ms)`,
      { videoUrl, videoDurationMs: MAX_VIDEO_MS + 13_000 },
      /Video too long/i,
    );
    await bad(
      'createPin từ chối videoUrl trỏ ra domain lạ (dùng CHUNG whitelist với URL ảnh)',
      { videoUrl: EVIL, videoDurationMs: 5000 },
      /videoUrl domain is not allowed/i,
    );

    // Biên DƯỚI của trần thời lượng: đúng mốc 30s + dung sai vẫn phải LỌT.
    // Không có phép này thì một bản cài đặt chặn ở 10_000ms cũng xanh ở phép
    // "quá dài" bên trên.
    {
      const d = await gql(
        `createPin CHẤP NHẬN đoạn đúng trần ${MAX_VIDEO_MS}ms (biên dưới — nếu không, "chặn mọi video" cũng xanh)`,
        M_CREATE,
        {
          i: {
            imageUrl: POSTER,
            imageWidth: 640,
            imageHeight: 360,
            title: T('bien'),
            videoUrl,
            videoDurationMs: MAX_VIDEO_MS,
          },
        },
        { token: probeToken },
      );
      assert(
        'pin ở đúng mốc trần được tạo thật',
        Boolean(d?.createPin?.id),
        d?.createPin?.id ?? '(không có id)',
      );
    }

    return true;
  } catch (e) {
    rec('bước 78 ném ngoại lệ', 'FAIL', String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
    return false;
  } finally {
    // ─── Tự dọn sau lưng ─────────────────────────────────────────────────────
    const gone = await prisma.pin
      .deleteMany({ where: { title: { startsWith: 'xh78' } } })
      .catch(() => ({ count: -1 }));
    const del = probeToken ? await silent(`mutation{ deleteAccount }`, {}, probeToken) : null;
    const accountGone = Boolean(probeToken) && !del?.errors;
    assert(
      'đã dọn: pin xh78* + tài khoản dùng-một-lần (pin của tài khoản này nằm trong exploreFeed của bước 80/90)',
      gone.count >= 0 && accountGone,
      `xoá ${gone.count} pin · deleteAccount ${accountGone ? 'ok' : 'LỖI: ' + JSON.stringify(del?.errors?.[0]?.message ?? del).slice(0, 110)}`,
    );
    await prisma.$disconnect().catch(() => {});
  }
}
