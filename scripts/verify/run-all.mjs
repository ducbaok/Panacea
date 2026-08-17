// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  run-all.mjs — chạy toàn bộ bộ verify bằng MỘT lệnh: `pnpm verify`        ║
// ║                                                                          ║
// ║  VÌ SAO FILE NÀY TỒN TẠI: bộ 103 phép kiểm tra đã từng chạy thật (28/07) ║
// ║  nhưng nằm trong thư mục temp, không chạy lại được. Hệ quả trực tiếp là   ║
// ║  11 đợt P1 bị ghi nhầm thành "đã xong" — không ai chạy lại được để biết   ║
// ║  điều ngược lại. Mọi khẳng định "xong" đều vô căn cứ cho tới khi lệnh     ║
// ║  này xanh.                                                               ║
// ║                                                                          ║
// ║  MỘT harness cho cả phiên: `state` mang token/id từ bước trước sang bước  ║
// ║  sau (bước 10 tạo pin → bước 40 comment lên chính pin đó). Đây là lý do   ║
// ║  các bước KHÔNG chạy song song được và KHÔNG đổi thứ tự được.            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { readdirSync, writeFileSync } from 'node:fs';
import { createHarness, API } from './lib/client.mjs';
import { createQueryCounter } from './lib/query-count.mjs';
import { assertVerifyLogAlive } from './lib/log-tripwire.mjs';

const stepsDir = new URL('./steps/', import.meta.url);

/**
 * Thứ tự = thứ tự tên file, KHÔNG phải thứ tự khai báo tay.
 * Tiền tố số (00, 10, 20…) chính là hợp đồng thứ tự; cách nhau 10 để chèn được
 * bước mới vào giữa mà không phải đổi tên hàng loạt.
 */
const stepFiles = readdirSync(stepsDir)
  .filter((f) => f.endsWith('.mjs'))
  .sort();

const h = createHarness();

// Bộ đếm query đọc stdout của API đã đổ ra file. Không có VERIFY_LOG ⇒ mọi phép
// `assertBatched` tự phát SKIP chứ KHÔNG phải OK giả. Xem README.md.
h.counter = createQueryCounter(process.env.VERIFY_LOG);

console.log(`API      : ${API}`);
console.log(`VERIFY_LOG: ${process.env.VERIFY_LOG ?? '(không có ⇒ phép đếm query sẽ SKIP)'}`);
console.log(`Các bước : ${stepFiles.join(', ')}\n`);

// ─── Dây bẫy tầng CÔNG CỤ, chạy trước bước đầu tiên ─────────────────────────
//
// Đặt ở đây chứ không thành một file trong `steps/` là có chủ ý: nó không kiểm
// tra một vùng tính năng nào cả, nó kiểm tra rằng **phép đo còn hoạt động**.
// Đặt vào `steps/` sẽ phải bịa một tiền tố số nhỏ hơn `00`, và sẽ khiến nó
// trông như một bước nghiệp vụ.
//
// KHÔNG dừng sớm khi nó đỏ: log chết không ngăn 282 phép còn lại chạy thật, và
// một FAIL kèm 11 SKIP là bức tranh đầy đủ hơn một lần dừng ở dòng đầu.
await assertVerifyLogAlive(h, h.counter);

let stoppedAt = null;

for (const file of stepFiles) {
  console.log(`\n═══════ ${file} ═══════`);
  let ok = false;
  try {
    const mod = await import(new URL(file, stepsDir).href);
    ok = await mod.default(h);
  } catch (e) {
    h.setGroup(file);
    h.rec(`bước ${file} ném ngoại lệ`, 'FAIL', e?.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e));
    ok = false;
  }
  if (!ok) {
    // Dừng sớm có chủ đích: bước sau phụ thuộc dữ liệu bước này tạo ra. Chạy
    // tiếp chỉ sinh ra một tràng FAIL thứ cấp che mất nguyên nhân thật.
    stoppedAt = file;
    break;
  }
}

// ══════════════════════ TỔNG KẾT ══════════════════════
const n = (s) => h.results.filter((r) => r.status === s).length;
const [ok, exp, fail, skip] = ['OK', 'EXPECTED', 'FAIL', 'SKIP'].map(n);

console.log('\n════════════ TỔNG KẾT ════════════');
console.log(`OK=${ok}  EXPECTED=${exp}  FAIL=${fail}  SKIP=${skip}  TOTAL=${h.results.length}`);

if (stoppedAt) {
  console.log(`\n⛔ DỪNG SỚM ở ${stoppedAt} — bước này không đạt tiền đề cho các bước sau.`);
  console.log('   Các bước còn lại KHÔNG chạy, nên tổng số ở trên chưa phải bộ đầy đủ.');
}

const fails = h.results.filter((r) => r.status === 'FAIL');
if (fails.length) {
  console.log('\n──── FAIL ────');
  for (const f of fails) console.log(`  ✗ ${f.group} :: ${f.name}\n      ${f.detail}`);
}

const skips = h.results.filter((r) => r.status === 'SKIP');
if (skips.length) {
  console.log('\n──── SKIP (không đo được — KHÔNG phải đạt) ────');
  for (const s of skips) console.log(`  ‣ ${s.group} :: ${s.name}\n      ${s.detail}`);
}

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(h.results, null, 2));
console.log('\n→ scripts/verify/results.json');

process.exit(fail || stoppedAt ? 1 : 0);
