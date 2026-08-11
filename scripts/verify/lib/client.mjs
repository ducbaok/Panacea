// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Verify harness — hạ tầng dùng chung cho mọi bước kiểm tra               ║
// ║                                                                          ║
// ║  Ba trạng thái, KHÔNG phải hai. Đây là điểm cốt lõi của bộ này:          ║
// ║    OK       — chạy được, trả dữ liệu hợp lệ                             ║
// ║    EXPECTED — trả lỗi ĐÚNG như dự đoán (401/403/404 có chủ đích)         ║
// ║               ⇒ đường code VẪN chạy qua, đó mới là thứ ta muốn biết      ║
// ║    FAIL     — lỗi ngoài dự đoán. 500 / TypeError / Cannot read = bug thật║
// ║                                                                          ║
// ║  Vì sao cần EXPECTED tách khỏi OK: rất nhiều phép kiểm tra ở đây CỐ Ý    ║
// ║  gọi sai (sửa pin người khác, đọc DM người lạ). Nếu gộp lỗi-có-chủ-đích  ║
// ║  vào FAIL thì bộ test luôn đỏ; nếu gộp vào OK thì một cú 500 thật sẽ     ║
// ║  lọt qua. isCrash() là đường phân giới giữa hai loại lỗi đó.             ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

export const API = process.env.VERIFY_API ?? 'http://localhost:4000';
export const GQL = `${API}/graphql`;
export const WS = API.replace(/^http/, 'ws') + '/graphql';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lỗi hạ tầng/lập trình — khác hẳn lỗi nghiệp vụ có chủ đích.
 * Bất cứ thứ gì khớp đây đều là FAIL kể cả khi test có `expect`.
 */
export const isCrash = (m = '') =>
  /internal server error|TypeError|Cannot read propert|undefined is not|PrismaClient|Unknown arg|is not a function|ECONNREFUSED/i.test(
    m,
  );

/**
 * Tạo một harness. Mỗi lần chạy `run-all.mjs` dùng đúng MỘT harness, được
 * truyền qua từng bước, nên `state` mang được id/token từ bước trước sang sau
 * (bước 10 tạo pin → bước 40 comment lên chính pin đó).
 */
export function createHarness() {
  const results = [];
  let group = 'init';

  const rec = (name, status, detail) => {
    results.push({ group, name, status, detail: detail ?? '' });
    // SKIP = phép đo KHÔNG chạy được (thiếu api.log). Cố ý tách khỏi OK:
    // "không đo được" không phải "đo xong và đạt".
    const tag = { OK: '  OK  ', EXPECTED: ' EXP  ', FAIL: ' FAIL ', SKIP: ' SKIP ' }[status];
    console.log(`[${tag}] ${group} :: ${name}${detail ? '  — ' + detail : ''}`);
  };

  /**
   * Gọi REST.
   * `expect` — mảng status code được coi là EXPECTED.
   * `match`  — regex phải khớp thân phản hồi. Chỉ status thôi là KHÔNG đủ:
   *   một request có thể trả đúng 400 vì một lý do hoàn toàn khác với thứ tên
   *   phép kiểm tra nói. Hai phép kiểm tra trong bộ này đã xanh suốt nhiều
   *   tháng đúng theo kiểu đó — chúng chết ở ValidationPipe trước khi chạm tới
   *   lớp kiểm tra secret mà tên chúng nhắc tới. `match` là thứ bắt được.
   */
  async function rest(name, method, path, { token, body, form, expect, match, headers: extra } = {}) {
    const headers = { ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    try {
      const r = await fetch(API + path, { method, headers, body: payload });
      const t = await r.text();
      let j;
      try {
        j = JSON.parse(t);
      } catch {
        j = t;
      }
      const short = (typeof j === 'string' ? j : JSON.stringify(j)).slice(0, 150);
      if (r.ok) {
        rec(name, 'OK', `${r.status}`);
        return j;
      }
      if (expect?.includes(r.status) && !isCrash(short)) {
        if (match && !match.test(short)) {
          rec(name, 'FAIL', `status ${r.status} đúng nhưng SAI LÝ DO — không khớp ${match}: ${short}`);
          return j;
        }
        rec(name, 'EXPECTED', `${r.status} ${short}`);
        return j;
      }
      rec(name, 'FAIL', `${r.status} ${short}`);
      return j;
    } catch (e) {
      rec(name, 'FAIL', `threw: ${e.message}`);
      return null;
    }
  }

  /**
   * Gọi GraphQL.
   * `expect: true`        — mong đợi MỘT lỗi nghiệp vụ bất kỳ (không phải crash)
   * `expect: /regex|str/` — mong đợi lỗi và thông điệp phải khớp; không khớp ⇒ FAIL.
   *   Dạng thứ hai chặt hơn, nên dùng cho phép kiểm tra mới: nó bắt được trường
   *   hợp code ném đúng "một lỗi nào đó" nhưng vì lý do hoàn toàn khác.
   */
  async function gql(name, query, variables, { token, expect } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      const r = await fetch(GQL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });
      const j = await r.json();
      if (j.errors?.length) {
        // originalError giữ được message gốc của ValidationPipe (mảng string)
        const raw = j.errors[0].extensions?.originalError?.message ?? j.errors[0].message;
        const msg = Array.isArray(raw) ? raw.join('; ') : String(raw);
        if (expect && !isCrash(msg)) {
          const matcher = expect === true ? null : expect;
          const ok =
            !matcher ||
            (matcher instanceof RegExp ? matcher.test(msg) : msg.toLowerCase().includes(String(matcher).toLowerCase()));
          if (ok) {
            rec(name, 'EXPECTED', msg.slice(0, 150));
            return null;
          }
          rec(name, 'FAIL', `lỗi sai loại: ${msg.slice(0, 150)}`);
          return null;
        }
        rec(name, 'FAIL', msg.slice(0, 180));
        return null;
      }
      rec(name, 'OK');
      return j.data;
    } catch (e) {
      rec(name, 'FAIL', `threw: ${e.message}`);
      return null;
    }
  }

  /**
   * Gọi GraphQL KHÔNG ghi kết quả — dùng để dựng/dọn dữ liệu nền.
   * Tách riêng vì việc dọn thất bại không phải là một phép kiểm tra hỏng.
   */
  async function silent(query, variables, token) {
    try {
      const r = await fetch(GQL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
      return await r.json();
    } catch {
      return null;
    }
  }

  /** Khẳng định trần — cho những thứ không phải một lời gọi API. */
  const assert = (name, cond, detail) => rec(name, cond ? 'OK' : 'FAIL', detail);

  return {
    results,
    rec,
    rest,
    gql,
    silent,
    assert,
    setGroup: (g) => {
      group = g;
    },
    /** Trạng thái chia sẻ giữa các bước: token, id đã tạo… */
    state: {},
  };
}

/**
 * Đọc một biến từ `apps/api/.env` khi phép kiểm tra cần đúng giá trị server
 * đang dùng (ví dụ `INTERNAL_API_SECRET` để gọi được nhánh THÀNH CÔNG của
 * endpoint Lambda callback).
 *
 * Cố ý KHÔNG hardcode secret vào repo. Ưu tiên biến môi trường; không có mới
 * đọc file `.env` của API. Không thấy ⇒ trả `null` và bên gọi phát SKIP —
 * không đo được thì không được coi là đạt.
 */
export function readApiEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const raw = readFileSync(new URL('../../../apps/api/.env', import.meta.url), 'utf8');
    const m = raw.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm'));
    return m?.[1] || null;
  } catch {
    return null;
  }
}

/** Đăng nhập nhanh, không ghi kết quả. Trả accessToken hoặc null. */
export async function login(email, password = 'password123') {
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return null;
    return (await r.json()).accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Sinh PNG hợp lệ với nhiễu ngẫu nhiên.
 *
 * Phải ngẫu nhiên: ảnh một màu nén xuống vài trăm byte và bị `/uploads/local`
 * từ chối bởi ngưỡng tối thiểu 1024 byte (P0 #7). Đây là lý do không dùng
 * ảnh 1x1 base64 cho sẵn.
 */
export function makePng(size = 64) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size * 3; x++) raw[y * (size * 3 + 1) + 1 + x] = (Math.random() * 256) | 0;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
