// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  log-tripwire.mjs — biến 11 SKIP im lặng thành 1 FAIL ồn ào               ║
// ║                                                                          ║
// ║  VÌ SAO FILE NÀY TỒN TẠI (đo được 17/08/2026, trong T3 của FE-11):       ║
// ║                                                                          ║
// ║      OK=250  EXPECTED=21  FAIL=0  SKIP=11  TOTAL=282     exit 0          ║
// ║                                                                          ║
// ║  `TOTAL`, `FAIL` và `EXPECTED` đều KHỚP mốc đã chốt, và tiến trình thoát  ║
// ║  bằng 0. Nhìn thoáng qua thì đó là một lần chạy đạt. Thực tế **11 phép    ║
// ║  `assertBatched` không chạy**: `api.log` ở thư mục gốc vẫn tồn tại, 1.5MB,║
// ║  đầy `prisma:query` — nhưng là của PHIÊN TRƯỚC. Tiến trình API đang giữ   ║
// ║  cổng 4000 ghi vào một file khác.                                         ║
// ║                                                                          ║
// ║  Tầng công cụ đã làm phần dễ: `query-count.mjs` phát `SKIP` kèm chẩn đoán ║
// ║  ĐÚNG, và README cảnh báo. Cái còn thiếu là **thời điểm**: 11 dòng SKIP   ║
// ║  rải rác giữa 282 dòng kết quả thì không ai đọc, và chúng chỉ xuất hiện   ║
// ║  sau khi cả bộ đã chạy xong. Dây bẫy này chạy TRƯỚC bước đầu tiên và nói  ║
// ║  thẳng ra câu lệnh sửa.                                                   ║
// ║                                                                          ║
// ║  Khuôn: phép ĐẦU TIÊN của bước 69 (dây bẫy trên bộ đếm brute-force của    ║
// ║  bao) — đỏ tại chỗ kèm lệnh gỡ, thay vì để lần chạy sau sụp không rõ vì   ║
// ║  đâu.                                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { existsSync } from 'node:fs';
import { API } from './client.mjs';

/**
 * Câu query dùng làm "một request thật".
 *
 * 🔴 KHÔNG dùng `{ __typename }` — nó được GraphQL trả lời từ schema và **không
 * chạm Prisma một lần nào**, nên log sẽ không lớn lên dù mọi thứ đều đúng: dây
 * bẫy sẽ đỏ vĩnh viễn, tức là vô dụng theo hướng ngược lại.
 *
 * `categories` được chọn vì nó hội đủ bốn điều kiện, và dây bẫy chạy TRƯỚC bước
 * 00 nên ba điều đầu là bắt buộc:
 *   • công khai — chưa có token nào tồn tại ở thời điểm này;
 *   • không tham số — không phụ thuộc id nào do seed hay bước trước tạo ra;
 *   • chỉ đọc — không để lại trạng thái cho 18 bước sau;
 *   • chắc chắn chạm DB — 12 category nằm trong bảng, không nằm trong bộ nhớ.
 */
const PROBE_QUERY = '{ categories { id slug } }';

const HOWTO =
  'Dựng log ĐÚNG CÁCH rồi chạy lại:\n' +
  "        pnpm --filter api start:dev *>&1 | Tee-Object -FilePath $env:TEMP\\antigravity-api.log\n" +
  '      rồi trỏ VERIFY_LOG vào ĐÚNG file đó. Hai nguồn sai thường gặp: (1) trỏ vào\n' +
  '      `api.log` cũ ở thư mục gốc — file có thật, to, đầy prisma:query của phiên\n' +
  '      TRƯỚC; (2) tiến trình đang giữ cổng 4000 không phải tiến trình ghi vào file đó.';

/**
 * Phép kiểm tra ĐẦU TIÊN của cả bộ: `VERIFY_LOG` có đang trỏ vào một file mà
 * API **đang thật sự ghi vào** không.
 *
 * Ba nhánh, và nhánh đầu cố ý KHÔNG phải lỗi:
 *
 * | Trạng thái                                   | Kết quả | Vì sao |
 * |---|---|---|
 * | `VERIFY_LOG` không đặt                        | `SKIP`  | Chạy nhanh không cần đo query là một lựa chọn hợp lệ — hành vi này giữ nguyên từ trước, đừng đổi |
 * | Đặt rồi nhưng file không tồn tại              | `FAIL`  | Đã tuyên bố muốn đo mà trỏ sai chỗ |
 * | Đặt rồi, file có, nhưng KHÔNG lớn lên         | `FAIL`  | Log chết — chính hình dạng đã cho `250/11 exit 0` |
 *
 * @param {ReturnType<import('./client.mjs').createHarness>} h
 * @param {{available: boolean, measure: Function}} counter
 */
export async function assertVerifyLogAlive(h, counter) {
  h.setGroup('TOOL/preflight');
  const name = 'VERIFY_LOG trỏ vào log mà API ĐANG ghi (nếu không: 11 phép đếm query sẽ SKIP im lặng)';
  const logPath = process.env.VERIFY_LOG;

  if (!logPath) {
    h.rec(
      name,
      'SKIP',
      'không đặt VERIFY_LOG ⇒ cố ý bỏ qua nhóm phép đếm query. ' +
        'Đây KHÔNG phải lỗi, nhưng lần chạy này không đủ tư cách chốt mốc (điều kiện đạt là SKIP=0).',
    );
    return;
  }

  if (!existsSync(logPath)) {
    h.rec(name, 'FAIL', `VERIFY_LOG="${logPath}" — file KHÔNG tồn tại. ${HOWTO}`);
    return;
  }

  // `counter.available` được chốt lúc `createQueryCounter` chạy. Nếu nó false
  // trong khi file có thật thì counter đã được dựng bằng một đường dẫn khác —
  // nói ra thay vì để 11 phép SKIP với lý do sai.
  if (!counter.available) {
    h.rec(name, 'FAIL', `file "${logPath}" có thật nhưng query-counter báo không dùng được. ${HOWTO}`);
    return;
  }

  // Đo bằng CHÍNH `counter.measure` mà 11 phép `assertBatched` sẽ dùng, chứ
  // không tự đọc `statSync` — nếu dùng cơ chế khác thì dây bẫy có thể xanh
  // trong khi cái nó bảo vệ vẫn hỏng. Đo `prisma:query` chứ không đo kích
  // thước: file vẫn có thể phình vì log của Nest trong khi Prisma log tắt.
  let probe;
  try {
    probe = await counter.measure(() =>
      fetch(`${API}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: PROBE_QUERY }),
      }).then((r) => r.json()),
    );
  } catch (e) {
    h.rec(name, 'FAIL', `không gọi được API tại ${API}: ${e.message}`);
    return;
  }

  if (probe.result?.errors?.length) {
    h.rec(name, 'FAIL', `query dò lỗi: ${JSON.stringify(probe.result.errors).slice(0, 150)}`);
    return;
  }

  if (!probe.queries) {
    h.rec(
      name,
      'FAIL',
      `một request THẬT (${PROBE_QUERY}) không sinh dòng prisma:query nào trong "${logPath}" ` +
        `⇒ log CHẾT. Bỏ qua sẽ ra một lần chạy trông như đạt (FAIL=0, exit 0) với 11 phép đếm query ` +
        `âm thầm SKIP. ${HOWTO}`,
    );
    return;
  }

  h.rec(name, 'OK', `1 request dò ⇒ ${probe.queries} dòng prisma:query mới trong "${logPath}"`);
}
