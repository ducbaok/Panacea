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

const FLUSH_MS = 200;

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

  /** Đọc [from, to) rồi đếm số lần xuất hiện `prisma:query`. */
  const countBetween = (from, to) =>
    new Promise((resolve) => {
      if (to <= from) return resolve(0);
      let n = 0;
      let tail = '';
      const s = createReadStream(logPath, { start: from, end: to - 1, encoding: 'utf8' });
      s.on('data', (chunk) => {
        // Nối phần đuôi kỳ trước để không cắt đôi chuỗi mốc giữa 2 chunk
        const buf = tail + chunk;
        n += (buf.match(/prisma:query/g) ?? []).length;
        tail = buf.slice(-16);
      });
      s.on('end', () => resolve(n));
      s.on('error', () => resolve(0));
    });

  return {
    available,

    /**
     * Chạy `fn` và đếm số query Prisma nó gây ra.
     * @returns {Promise<{ result: any, queries: number|null }>}
     */
    async measure(fn) {
      if (!available) return { result: await fn(), queries: null };
      const before = size();
      const result = await fn();
      await new Promise((r) => setTimeout(r, FLUSH_MS));
      const after = size();
      if (before == null || after == null) return { result, queries: null };
      return { result, queries: await countBetween(before, after) };
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
  const delta = b.queries - a.queries;
  const detail = `first=${small} → ${a.queries} query · first=${large} → ${b.queries} query (Δ=${delta})`;
  if (delta <= tolerance) h.rec(name, 'OK', detail);
  else h.rec(name, 'FAIL', `${detail} — số query tăng theo kích thước trang ⇒ CÒN N+1`);
}
