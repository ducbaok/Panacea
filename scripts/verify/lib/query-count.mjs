// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Query counter — bằng chứng DataLoader THẬT SỰ batch                     ║
// ║                                                                          ║
// ║  VÌ SAO CẦN: "field trả đúng giá trị" KHÔNG chứng minh được gì về N+1.   ║
// ║  Code N+1 cũng trả đúng giá trị — nó chỉ chậm. Đây chính là cách bug     ║
// ║  buildIsFollowedByLoader (tạo DataLoader mới mỗi lần resolve field) sống ║
// ║  sót qua mọi đợt kiểm tra trước: mọi phép kiểm tra đều xanh.             ║
// ║                                                                          ║
// ║  CÁCH ĐO: PrismaService bật log:['query'] khi NODE_ENV=development       ║
// ║  (prisma.service.ts:25). Chạy API với stdout đổ vào file, rồi đếm dòng   ║
// ║  `prisma:query` sinh ra trong khoảng giữa hai byte-offset.               ║
// ║                                                                          ║
// ║  PHÉP KIỂM QUYẾT ĐỊNH là BẤT BIẾN THEO KÍCH THƯỚC TRANG, không phải     ║
// ║  con số tuyệt đối:                                                       ║
// ║      count(first: 5)  ===  count(first: 20)                              ║
// ║  Batch đúng ⇒ số query không đổi khi trang to gấp 4.                     ║
// ║  N+1        ⇒ tăng tuyến tính.                                           ║
// ║  Bằng chứng này bền qua mọi lần đổi implementation — không phải sửa lại  ║
// ║  con số kỳ vọng mỗi lần thêm một loader.                                 ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { statSync, createReadStream, existsSync } from 'node:fs';

/**
 * Thời gian chờ TỐI ĐA cho stdout của API chạm đĩa. Trước 17/08/2026 đây là
 * một `sleep(200)` cứng, và đó là một nguồn nhiễu đo được: `Tee-Object` gom
 * bộ đệm theo nhịp riêng của nó, nên một dòng `prisma:query` sinh ra ĐÚNG LÚC
 * cửa sổ đo đóng lại có thể rơi ra ngoài khoảng [before, after) ⇒ đếm hụt.
 * Nay chờ tới khi file NGỪNG LỚN (`SETTLE_QUIET_MS` liên tiếp không đổi) rồi
 * mới chốt mốc — nhanh hơn trong trường hợp thường và không hụt khi log trễ.
 */
const SETTLE_MAX_MS = 1500;
const SETTLE_QUIET_MS = 120;
const SETTLE_POLL_MS = 30;

/**
 * @param {string|undefined} logPath Đường dẫn file log stdout của API.
 *   Không truyền / file không tồn tại ⇒ counter ở chế độ "không đo được",
 *   `measure()` trả `queries: null`. Bên gọi PHẢI xử lý null bằng SKIP chứ
 *   không được coi là đạt — không đo được thì không có bằng chứng.
 */
export function createQueryCounter(logPath) {
  const available = Boolean(logPath) && existsSync(logPath);

  const size = () => {
    try {
      return statSync(logPath).size;
    } catch {
      return null;
    }
  };

  /** Đọc [from, to) rồi đếm số lần khớp `pattern` (mặc định: `prisma:query`). */
  const countBetween = (from, to, pattern = /prisma:query/g) =>
    new Promise((resolve) => {
      if (to <= from) return resolve(0);
      let n = 0;
      let tail = '';
      const s = createReadStream(logPath, { start: from, end: to - 1, encoding: 'utf8' });
      s.on('data', (chunk) => {
        // Nối phần đuôi kỳ trước để không cắt đôi chuỗi mốc giữa 2 chunk
        const buf = tail + chunk;
        n += (buf.match(pattern) ?? []).length;
        tail = buf.slice(-64);
      });
      s.on('end', () => resolve(n));
      s.on('error', () => resolve(0));
    });

  /** Chờ file log ngừng lớn — xem khối giải thích ở `SETTLE_MAX_MS`. */
  const settle = async () => {
    const t0 = Date.now();
    let last = size();
    let quietSince = Date.now();
    while (Date.now() - t0 < SETTLE_MAX_MS) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
      const now = size();
      if (now !== last) {
        last = now;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= SETTLE_QUIET_MS) {
        return;
      }
    }
  };

  return {
    available,

    /**
     * Chạy `fn` và đếm số dòng log khớp `pattern` mà nó gây ra.
     * @returns {Promise<{ result: any, queries: number|null }>}
     */
    async measure(fn, pattern) {
      if (!available) return { result: await fn(), queries: null };
      const before = size();
      const result = await fn();
      await settle();
      const after = size();
      if (before == null || after == null) return { result, queries: null };
      return { result, queries: await countBetween(before, after, pattern) };
    },
  };
}

/**
 * Phép kiểm tra dùng lại được: gọi cùng một query với 2 kích thước trang và
 * khẳng định số query Prisma KHÔNG tăng.
 *
 * Cho phép chênh nhỏ (`tolerance`) vì trang lớn hơn có thể chạm thêm vài bản
 * ghi cha hợp lệ (ví dụ nhiều creator khác nhau hơn ⇒ vẫn 1 query batch, nhưng
 * một số loader chỉ được kích hoạt khi có dữ liệu). Chênh do N+1 luôn xấp xỉ
 * bằng hiệu số item, tức là lớn hơn tolerance rất nhiều.
 */
export async function assertBatched(h, counter, name, runWithFirst, { small = 5, large = 20, tolerance = 2 } = {}) {
  if (!counter.available) {
    h.rec(name, 'SKIP', 'không có api.log ⇒ không đo được số query (xem scripts/verify/README.md)');
    return;
  }
  // Lần chạy khởi động: nạp cache Prisma/JIT để không tính vào phép đo
  await runWithFirst(small);

  const a = await counter.measure(() => runWithFirst(small));
  const b = await counter.measure(() => runWithFirst(large));

  if (a.queries == null || b.queries == null) {
    h.rec(name, 'SKIP', 'đọc log thất bại giữa chừng');
    return;
  }

  // ╔═══════════════════════════════════════════════════════════════════════════╗
  // ║  0 và 0 KHÔNG PHẢI Δ=0 — đó là "không đo được" đội lốt "đạt". (17/08)    ║
  // ║                                                                          ║
  // ║  Prisma không có cache truy vấn: một query GraphQL trả về dữ liệu LUÔN    ║
  // ║  sinh ít nhất một dòng `prisma:query`. Đọc ra 0 nghĩa là log không nhận   ║
  // ║  được gì — `VERIFY_LOG` trỏ vào file cũ, hoặc tiến trình API đang giữ     ║
  // ║  cổng 4000 là tiến trình KHÁC với tiến trình đang ghi vào file đó (bẫy    ║
  // ║  "process node cũ", `docs/debug_history.md §7`).                         ║
  // ║                                                                          ║
  // ║  Không có nhánh này thì phép so sánh tương đối `0 - 0 = 0 ≤ tolerance`    ║
  // ║  cho ra **OK** — cả nhóm `GQL/perf` xanh rực trong khi chưa đo gì cả.     ║
  // ║  Đây là lời giải cho hình dạng FAIL "trôi" quan sát sau FE-6: phép memo   ║
  // ║  của `65-blocking` khẳng định một con số TUYỆT ĐỐI (=1) nên nó là phép    ║
  // ║  DUY NHẤT trong bộ nhìn thấy được log chết; mọi phép Δ đều im lặng xanh.  ║
  // ╚═══════════════════════════════════════════════════════════════════════════╝
  if (a.queries === 0 && b.queries === 0) {
    h.rec(
      name,
      'SKIP',
      'log KHÔNG có dòng prisma:query nào ⇒ chưa đo được gì (Δ=0 ở đây là giả). ' +
        'Kiểm: VERIFY_LOG có đúng file mà API đang ghi vào không, và API đang chạy có phải tiến trình đó không',
    );
    return;
  }

  const delta = b.queries - a.queries;
  const detail = `first=${small} → ${a.queries} query · first=${large} → ${b.queries} query (Δ=${delta})`;
  if (delta <= tolerance) h.rec(name, 'OK', detail);
  else h.rec(name, 'FAIL', `${detail} — số query tăng theo kích thước trang ⇒ CÒN N+1`);
}
