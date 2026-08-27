// Bước 19 — Cửa upload PRODUCTION: presigned POST + đường ĐỌC media (27/08/2026)
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  VÌ SAO BƯỚC NÀY TỒN TẠI — MỘT VÒNG LẶP TỰ CHẶN CHÍNH MÌNH               ║
// ║                                                                           ║
// ║  Cả bộ verify (và cả frontend, tới 27/08/2026) chỉ đi cửa                 ║
// ║  `POST /uploads/local`. Nhưng API CHẶN CỨNG cửa đó khi                    ║
// ║  `NODE_ENV=production` — Fargate có filesystem ephemeral. Nghĩa là con     ║
// ║  đường upload DUY NHẤT chạy trên production **chưa từng có một phép đo    ║
// ║  nào**, và nó chứa một lỗi kín:                                          ║
// ║                                                                           ║
// ║    `uploads.service` ký cho phép ghi lên bucket ở ap-southeast-1, host    ║
// ║    `<bucket>.s3.ap-southeast-1.amazonaws.com`. Whitelist của `createPin`  ║
// ║    lại hardcode `'s3.amazonaws.com'`, và phép so là                      ║
// ║    `host === d || host.endsWith('.' + d)` ⇒ chuỗi trên kết thúc bằng      ║
// ║    `.s3.ap-southeast-1.amazonaws.com`, KHÔNG khớp. Tức là API **cấp phép  ║
// ║    upload lên đúng cái host mà chính nó từ chối lúc tạo pin**.            ║
// ║                                                                           ║
// ║  Ở localhost lỗi này VÔ HÌNH tuyệt đối: mọi URL đều là `localhost`.       ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
//
// 🔴 PHÉP QUAN TRỌNG NHẤT LÀ MỤC 4 — "URL do CHÍNH API cấp phải qua được
// createPin". Nó nối hai đầu của vòng lặp lại với nhau, và nó ĐỘC LẬP VỚI MÔI
// TRƯỜNG: host không hardcode ở đây mà đọc ra từ `publicUrl` của chính response
// presigned. Máy dev, CI, hay production đều đo cùng một mệnh đề.
//
// ⚠️ KHÔNG có byte nào được upload thật ở bước này, và đó là CHỦ ĐÍCH: máy dev
// và CI không có credential AWS thật. `createPresignedPost` ký hoàn toàn cục bộ
// (không gọi mạng), nên mọi thứ dưới đây đo được mà không cần tài khoản AWS.
// Việc S3 có NHẬN file hay không là phép của đợt deploy, đo trên hạ tầng thật.
//
// ⚠️ MỤC 3 ĐỌC THẲNG `Policy` (base64 JSON) thay vì tin vào tài liệu: trần dung
// lượng THEO LOẠI (10MB ảnh / 30MB video) chỉ có hiệu lực khi nó nằm trong
// `content-length-range` của policy đã KÝ. Một bản cài đặt trả đúng
// `{url,fields,key}` nhưng quên `maxUploadBytesFor` vẫn xanh với mọi phép khác.
//
// ⚠️ DỌN Ở ĐẦU BƯỚC: pin `pm19*` + tài khoản `pm19_*`.
//
// VỊ TRÍ 19: sau 18 (tracking), trước 20 (social). Cần token và cần chạy trước
// mọi bước đối chiếu tập pin của feed; bước này tự dọn nên không để lại gì.

import { createRequire } from 'node:module';
import { readApiEnv, API } from '../lib/client.mjs';

const require = createRequire(import.meta.url);

const TITLE = 'pm19 pin qua cua presigned';
const M_CREATE = `mutation($i:CreatePinInput!){ createPin(input:$i){ id imageUrl } }`;

/** Trần phải khớp `uploads.service.ts` — hai bản số này là hợp đồng, không phải gợi ý. */
const MAX_IMAGE_BYTES = 10_485_760;
const MAX_VIDEO_BYTES = 31_457_280;
const MIN_BYTES = 1024;

/** Giải `Policy` (base64 JSON) và tìm điều kiện `content-length-range`. */
function lengthRangeOf(fields) {
  try {
    const raw = Buffer.from(String(fields?.Policy ?? ''), 'base64').toString('utf8');
    const conds = JSON.parse(raw)?.conditions ?? [];
    const hit = conds.find((c) => Array.isArray(c) && c[0] === 'content-length-range');
    return hit ? { min: Number(hit[1]), max: Number(hit[2]) } : null;
  } catch {
    return null;
  }
}

export default async function (h) {
  const { gql, rest, silent, assert, rec, state } = h;
  h.setGroup('REST/presigned');

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

  try {
    // ═══ DỌN Ở ĐẦU BƯỚC ═════════════════════════════════════════════════════
    {
      const pins = await prisma.pin.deleteMany({ where: { title: { startsWith: 'pm19' } } });
      const users = await prisma.user.deleteMany({ where: { email: { startsWith: 'pm19_' } } });
      rec(
        'dọn state sống lâu Ở ĐẦU BƯỚC (pin pm19* + tài khoản pm19_*)',
        'OK',
        `xoá ${pins.count} pin · ${users.count} tài khoản`,
      );
    }

    // ═══ 0. Tài khoản dùng-một-lần ══════════════════════════════════════════
    //
    // KHÔNG tiêu quota tạo pin của bao: bao là tiền đề cứng của hàng chục phép
    // ở các bước sau, và trần 20 pin/ngày đếm cả pin đã xoá mềm.
    let token = null;
    {
      const email = `pm19_${state.uniq}@example.com`;
      const r = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Presigned probe' }),
      });
      const body = await r.json().catch(() => null);
      token = body?.accessToken ?? null;
      assert(
        'đăng ký tài khoản dùng-một-lần pm19_<uniq>@example.com (KHÔNG tiêu quota tạo pin của bao)',
        Boolean(token),
        token ? 'có accessToken' : `KHÔNG có accessToken: ${JSON.stringify(body).slice(0, 120)}`,
      );
      if (!token) return false;
    }

    // ═══ 1. Hai cửa từ chối ═════════════════════════════════════════════════
    await rest(
      'POST /uploads/presigned-url KHÔNG token → 401 (cửa production cũng phải sau AuthGuard, y như /uploads/local)',
      'POST',
      '/uploads/presigned-url',
      { body: { contentType: 'image/jpeg' }, expect: [401], match: /unauthorized/i },
    );

    await rest(
      'POST /uploads/presigned-url từ chối MIME ngoài whitelist (application/pdf)',
      'POST',
      '/uploads/presigned-url',
      {
        token,
        body: { contentType: 'application/pdf' },
        expect: [400],
        match: /contentType must be one of/i,
      },
    );

    // ═══ 2. Hình dạng phản hồi ══════════════════════════════════════════════
    let signed = null;
    {
      signed = await rest(
        'POST /uploads/presigned-url (image/jpeg) trả đủ url + fields + key + publicUrl',
        'POST',
        '/uploads/presigned-url',
        { token, body: { contentType: 'image/jpeg', folder: 'pins' } },
      );

      assert(
        'key nằm đúng tiền tố `raw/pins/<userId>/` và mang đuôi suy TỪ MIME (.jpg), không từ tên client gửi',
        typeof signed?.key === 'string' &&
          signed.key.startsWith('raw/pins/') &&
          signed.key.endsWith('.jpg'),
        String(signed?.key).slice(0, 110),
      );

      assert(
        'fields mang đủ chữ ký của Presigned POST (Policy + X-Amz-Signature + Content-Type khớp thứ đã xin)',
        Boolean(signed?.fields?.Policy) &&
          Boolean(signed.fields['X-Amz-Signature']) &&
          signed.fields['Content-Type'] === 'image/jpeg',
        `Policy=${Boolean(signed?.fields?.Policy)} · sig=${Boolean(signed?.fields?.['X-Amz-Signature'])} · CT=${signed?.fields?.['Content-Type']}`,
      );

      // 🔴 `publicUrl` do SERVER trả, không để client ghép. Client là Next.js,
      // mọi NEXT_PUBLIC_* bị nướng vào bundle lúc build ⇒ để client ghép nghĩa
      // là đổi hạ tầng đọc ảnh phải build lại image Web, và nếu quên thì URL
      // SAI được lưu VĨNH VIỄN vào cột imageUrl.
      assert(
        'publicUrl là URL tuyệt đối https và kết thúc đúng bằng `/<key>` (server quyết định đường đọc, client KHÔNG tự ghép)',
        typeof signed?.publicUrl === 'string' &&
          signed.publicUrl.startsWith('https://') &&
          signed.publicUrl.endsWith('/' + signed.key),
        String(signed?.publicUrl).slice(0, 130),
      );
    }

    // ═══ 3. Trần dung lượng phải nằm TRONG POLICY ĐÃ KÝ ═════════════════════
    {
      const imgRange = lengthRangeOf(signed?.fields);
      assert(
        `ảnh: policy đã ký mang content-length-range [${MIN_BYTES}, ${MAX_IMAGE_BYTES}] — trần thật nằm ở S3, không phải chỉ ở tài liệu`,
        imgRange?.min === MIN_BYTES && imgRange?.max === MAX_IMAGE_BYTES,
        imgRange ? `[${imgRange.min}, ${imgRange.max}]` : '(không đọc được Policy)',
      );

      const vid = await rest(
        'POST /uploads/presigned-url (video/webm) được chấp nhận và trả key đuôi .webm',
        'POST',
        '/uploads/presigned-url',
        { token, body: { contentType: 'video/webm' } },
      );
      assert(
        'key video mang đuôi .webm',
        typeof vid?.key === 'string' && vid.key.endsWith('.webm'),
        String(vid?.key).slice(0, 110),
      );

      const vidRange = lengthRangeOf(vid?.fields);
      assert(
        `video: policy đã ký mang trần RIÊNG ${MAX_VIDEO_BYTES} (30MB) chứ không dùng chung trần ảnh — đối chứng: hai con số phải KHÁC nhau`,
        vidRange?.max === MAX_VIDEO_BYTES && vidRange.max !== imgRange?.max,
        vidRange ? `ảnh=${imgRange?.max} · video=${vidRange.max}` : '(không đọc được Policy)',
      );
    }

    // ═══ 4. 🔴 NỐI HAI ĐẦU: URL do CHÍNH API cấp phải qua được createPin ════
    let pinId = null;
    {
      const created = await gql(
        '🔴 createPin CHẤP NHẬN `publicUrl` mà chính API vừa cấp phép ghi lên (whitelist domain đọc env, không hardcode — trước 27/08 host S3 theo region bị chính API từ chối)',
        M_CREATE,
        { i: { imageUrl: signed.publicUrl, imageWidth: 64, imageHeight: 64, title: TITLE } },
        { token },
      );
      pinId = created?.createPin?.id ?? null;
      assert(
        'pin được tạo thật và giữ nguyên imageUrl đã gửi',
        Boolean(pinId) && created?.createPin?.imageUrl === signed.publicUrl,
        `${pinId ?? '(không id)'} · ${String(created?.createPin?.imageUrl).slice(0, 90)}`,
      );

      // Đối chứng âm — nếu thiếu, một whitelist bị nới thành "cho tất cả" vẫn
      // làm phép trên xanh trọn vẹn.
      const host = new URL(signed.publicUrl).hostname;
      await gql(
        'đối chứng âm: đổi ĐÚNG phần host của URL đó sang domain lạ ⇒ createPin từ chối (whitelist vẫn siết, không phải đã mở toang)',
        M_CREATE,
        {
          i: {
            imageUrl: signed.publicUrl.replace(host, 'evil.example.com'),
            imageWidth: 64,
            imageHeight: 64,
            title: TITLE + ' evil',
          },
        },
        { token, expect: /domain is not allowed/i },
      );
    }

    return true;
  } catch (e) {
    rec('bước 19 ném ngoại lệ', 'FAIL', String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
    return false;
  } finally {
    const pins = await prisma.pin
      .deleteMany({ where: { title: { startsWith: 'pm19' } } })
      .catch(() => ({ count: -1 }));
    const users = await prisma.user
      .deleteMany({ where: { email: { startsWith: 'pm19_' } } })
      .catch(() => ({ count: -1 }));
    assert(
      'đã dọn: pin pm19* + tài khoản probe bị xoá CỨNG (pin của nó nằm trong exploreFeed của các bước sau; tài khoản xoá mềm làm lệch phép đếm purge của bước 80)',
      pins.count >= 0 && users.count >= 0,
      `xoá ${pins.count} pin · ${users.count} tài khoản`,
    );
    await prisma.$disconnect().catch(() => {});
  }
}
