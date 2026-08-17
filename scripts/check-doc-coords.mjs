#!/usr/bin/env node
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  check-doc-coords.mjs — canh link markdown + toạ độ `file:line` hỏng       ║
// ║                                                                            ║
// ║  CHẠY (từ bất kỳ thư mục nào — root repo được suy ra từ vị trí script):    ║
// ║    node scripts/check-doc-coords.mjs           # quét root/*.md + docs/**  ║
// ║    node scripts/check-doc-coords.mjs a.md b.md  # quét đúng các file nêu   ║
// ║                                                                            ║
// ║  BẮT hai dạng tham chiếu:                                                  ║
// ║    1. link markdown  [nhãn](path) / [nhãn](path#anchor) / [nhãn](path:line)║
// ║    2. ref inline code `path:line`  (vd `pins.service.ts:154`)              ║
// ║                                                                            ║
// ║  KIỂM:                                                                     ║
// ║    • File đích tồn tại  → không thì ERROR.                                 ║
// ║    • Có `:line` → line ≤ tổng số dòng file → vượt thì WARN                 ║
// ║      (chỉ WARN: nội dung dòng có thể đã trôi mà số dòng vẫn hợp lệ — máy   ║
// ║       không bắt được cái đó, đừng hứa quá).                                ║
// ║                                                                            ║
// ║  GIẢI ĐƯỜNG DẪN (tìm khớp CHÍNH XÁC trước, RÚT GỌN sau):                   ║
// ║    • `./x`, `../x`, `/x`  → chính xác từ thư mục .md (hoặc root cho `/`);  ║
// ║      KHÔNG fuzzy (người viết đã nói rõ chỗ).                               ║
// ║    • `apps/api/…` (trần)  → thử chính xác (thư mục .md, rồi root).         ║
// ║    • Rút gọn có `/`, vd `auth/ws-auth.ts` → khớp HẬU TỐ toàn repo          ║
// ║      (`apps/api/src/auth/ws-auth.ts`) — nếp viết tắt bỏ `apps/*/src` của   ║
// ║      các brief. Basename trần `client.mjs` → tra chỉ mục basename.         ║
// ║        0 khớp → ERROR;  1 khớp → dùng;  >1 → WARN (không chắc file nào).   ║
// ║    • Đích là THƯ MỤC vẫn hợp lệ (link tới `apps/web/app/probe/`).          ║
// ║    • File trong node_modules (vd nội bộ của @nestjs/core): ĐỪNG viết dạng  ║
// ║      `ten-file.js:line` — script KHÔNG index node_modules, và CI trên máy  ║
// ║      sạch còn chưa cài dependency ⇒ kết quả sẽ khác nhau theo máy. Viết    ║
// ║      `ten-file.js` của `pkg@version`, dòng N–M (không có dấu `:` ⇒ bỏ qua).║
// ║    • URL http/https/mailto (kể cả trong inline code), anchor thuần `#…`     ║
// ║      → bỏ qua.                                                             ║
// ║    • Fenced code block (``` hoặc ~~~) → bỏ qua toàn khối (ví dụ trong đó    ║
// ║      không phải trích dẫn thật, tránh false-positive).                     ║
// ║                                                                            ║
// ║  EXIT:   1 nếu có ≥1 ERROR (để HT-2 / Luồng 3 móc vào CI). 0 nếu chỉ WARN  ║
// ║          hoặc sạch.                                                        ║
// ║  RANH GIỚI: script chỉ BÁO, KHÔNG tự sửa. Không đụng `.github/**`.         ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// Thư mục không bao giờ đi vào — vừa để quét .md, vừa để dựng chỉ mục basename.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.turbo', '.pnpm', 'out',
  // `.claude/worktrees/**` là bản checkout SONG SONG của chính repo (thiết lập
  // 5 luồng). Nếu để lọt vào chỉ mục basename thì mọi file bị đếm gấp đôi →
  // hàng loạt WARN "trùng 2 file" và tệ hơn: một basename chỉ còn trong worktree
  // vẫn được coi là "ok". Bỏ cả `.claude`.
  '.claude',
]);

// Bỏ theo ĐƯỜNG DẪN CỤ THỂ (posix, tính từ REPO_ROOT) — khác SKIP_DIRS ở chỗ
// SKIP_DIRS khớp theo TÊN thư mục ở bất kỳ độ sâu nào.
//   `apps/api/uploads/` = kho ảnh test (88 file), đúng là không nên index.
//   Nhưng `apps/api/src/uploads/` là MÃ NGUỒN THẬT (uploads.controller.ts,
//   uploads.service.ts). Khi 'uploads' còn nằm trong SKIP_DIRS, cả hai cùng bị
//   bỏ ⇒ mọi toạ độ trỏ vào `apps/api/src/uploads/**` bị báo ERROR "không tìm
//   thấy file" DÙ ĐÚNG — tức script đẩy người viết đi sửa một toạ độ vốn không
//   hỏng. Đó là loại dương tính giả tệ hơn cả bỏ sót.
const SKIP_PATHS = new Set([
  'apps/api/uploads',
]);

// Ref inline chỉ tính là "toạ độ" khi phần trước dấu `:` kết thúc bằng một đuôi
// file mã nguồn đã biết. Thiếu ràng buộc này thì `10.0.2.2:4000` (host:port viết
// trong code) sẽ bị hiểu nhầm là `file:line`.
const CODE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'prisma', 'sql', 'md', 'mdx',
  'yaml', 'yml', 'kt', 'kts', 'gradle', 'css', 'scss', 'html', 'env', 'sh',
  'toml', 'lock', 'txt', 'graphql', 'gql', 'xml', 'properties', 'example',
]);

// ─── Duyệt cây file ──────────────────────────────────────────────────────────

/** Trả về mọi file (đường dẫn tuyệt đối) dưới `dir`, bỏ SKIP_DIRS. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (SKIP_PATHS.has(path.relative(REPO_ROOT, abs).split(path.sep).join('/'))) continue;
      walk(abs, out);
    } else if (e.isFile()) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

// Chỉ mục toàn repo (dựng một lần):
//   • BASENAME_INDEX: basename → [abs] để giải ref trần `client.mjs:135`.
//   • REL_LIST: {abs, rel(posix)} để giải ĐƯỜNG DẪN RÚT GỌN kiểu
//     `auth/ws-auth.ts` (thật ra là `apps/api/src/auth/ws-auth.ts`) bằng khớp
//     hậu tố — nếp viết tắt phổ biến trong các brief của dự án. Khớp hậu tố
//     DUY NHẤT ⇒ ok; nhiều ⇒ WARN; không có ⇒ ERROR (link hỏng thật).
const ALL_FILES = walk(REPO_ROOT);
const BASENAME_INDEX = new Map();
const REL_LIST = [];
for (const f of ALL_FILES) {
  const b = path.basename(f);
  const arr = BASENAME_INDEX.get(b);
  if (arr) arr.push(f);
  else BASENAME_INDEX.set(b, [f]);
  REL_LIST.push({ abs: f, rel: path.relative(REPO_ROOT, f).replace(/\\/g, '/') });
}

// Cache số dòng theo file để không đọc lại nhiều lần.
const LINE_COUNT_CACHE = new Map();
function lineCountOf(absFile) {
  if (LINE_COUNT_CACHE.has(absFile)) return LINE_COUNT_CACHE.get(absFile);
  let n = 0;
  try {
    const txt = fs.readFileSync(absFile, 'utf-8');
    // Số dòng = số ký tự '\n' + 1 (dòng cuối không kết thúc bằng newline vẫn tính).
    n = txt.length === 0 ? 0 : txt.split('\n').length;
  } catch {
    n = 0;
  }
  LINE_COUNT_CACHE.set(absFile, n);
  return n;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Tồn tại như FILE hoặc THƯ MỤC (link tới thư mục là hợp lệ trong tài liệu). */
function existsPath(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

// ─── Bóc tách tham chiếu ─────────────────────────────────────────────────────

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//; // http://, https://, ftp://…
const MAILTO_RE = /^(mailto|tel):/i;
const COORD_RE = /^(.*?):(\d+)(?:-\d+)?$/; // path:line hoặc path:line-line

/**
 * Tách một href/token thành { path, line } hoặc null nếu không phải path cục bộ.
 * `line` là số nguyên hoặc null.
 */
function parsePathToken(rawInput) {
  let raw = rawInput.trim();
  if (!raw) return null;
  // `<url>` dạng ngoặc nhọn.
  if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1).trim();
  // Bỏ tiêu đề: [x](path "title") → chỉ lấy token đầu.
  raw = raw.split(/\s+/)[0];
  if (!raw) return null;

  if (SCHEME_RE.test(raw) || MAILTO_RE.test(raw)) return null; // URL ngoài
  if (raw.startsWith('#')) return null; // anchor thuần trong trang

  // Bỏ phần #anchor (chỉ kiểm file, không kiểm anchor — xem docblock).
  const hashIdx = raw.indexOf('#');
  let pathPart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  if (!pathPart) return null;

  // Tách `:line` ở đuôi nếu có.
  let line = null;
  const m = pathPart.match(COORD_RE);
  if (m) {
    pathPart = m[1];
    line = parseInt(m[2], 10);
  }
  if (!pathPart) return null;
  return { path: pathPart, line };
}

/** Ref inline `path:line` — chỉ nhận khi đuôi file nằm trong CODE_EXT. */
function parseCodeRef(content) {
  const trimmed = content.trim();
  // `http://localhost:4000`, `https://…:443` trong code KHÔNG phải file:line.
  if (SCHEME_RE.test(trimmed) || MAILTO_RE.test(trimmed)) return null;
  const m = trimmed.match(COORD_RE);
  if (!m) return null;
  const p = m[1];
  const line = parseInt(m[2], 10);
  const extMatch = p.match(/\.([A-Za-z0-9]+)$/);
  const hasSlash = p.includes('/') || p.includes('\\');
  if (!extMatch && !hasSlash) return null;
  if (extMatch && !CODE_EXT.has(extMatch[1].toLowerCase()) && !hasSlash) return null;
  return { path: p, line };
}

// ─── Giải đường dẫn về file thật ─────────────────────────────────────────────

/**
 * Trả về { status, file?, files? } với status ∈ 'ok' | 'missing' | 'ambiguous'.
 *   ok        → `file` là đường dẫn tuyệt đối tồn tại.
 *   missing   → không giải được về file nào.
 *   ambiguous → basename trùng >1 file (không soi được số dòng chắc chắn).
 */
function resolveTarget(rawPath, mdDir) {
  const norm = rawPath.replace(/\\/g, '/').replace(/\/+$/, ''); // bỏ `/` cuối (link thư mục)
  if (!norm) return { status: 'ok' }; // link tới chính thư mục hiện tại

  // ── 1. Giải CHÍNH XÁC theo path (chấp nhận cả file lẫn thư mục) ──
  const exact = [];
  if (norm.startsWith('/')) {
    exact.push(path.join(REPO_ROOT, norm));
  } else if (norm.startsWith('./') || norm.startsWith('../')) {
    exact.push(path.resolve(mdDir, norm));
  } else {
    // `apps/api/…` hoặc `flows.md` trần: thử cạnh file .md rồi từ root.
    exact.push(path.resolve(mdDir, norm));
    exact.push(path.join(REPO_ROOT, norm));
  }
  for (const c of exact) if (existsPath(c)) return { status: 'ok', file: c };

  // Path tường minh (`./`, `../`, `/…`) KHÔNG fuzzy — người viết đã nói rõ chỗ.
  if (norm.startsWith('/') || norm.startsWith('./') || norm.startsWith('../')) {
    return { status: 'missing' };
  }

  // ── 2. Giải RÚT GỌN ──
  let hits;
  if (norm.includes('/')) {
    // Hậu tố: `auth/ws-auth.ts` khớp `apps/api/src/auth/ws-auth.ts`.
    hits = REL_LIST.filter((x) => x.rel === norm || x.rel.endsWith('/' + norm)).map((x) => x.abs);
  } else {
    // Basename trần.
    hits = BASENAME_INDEX.get(norm) || [];
  }
  if (hits.length === 0) return { status: 'missing' };
  if (hits.length === 1) return { status: 'ok', file: hits[0] };
  return { status: 'ambiguous', files: hits };
}

// ─── Quét một file .md ───────────────────────────────────────────────────────

// Cho phép MỘT cấp ngoặc lồng trong đích link để bắt được path Next.js route
// group như `apps/web/app/(main)/page.tsx`. `[^)]+` trần sẽ cắt ở `)` đầu tiên.
const LINK_RE = /\[[^\]]*?\]\(((?:[^()]|\([^()]*\))*)\)/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const FENCE_RE = /^\s*(```|~~~)/;

/** Ghi nhận một phát hiện. */
function makeFinding(mdRel, lineNo, kind, raw, level, reason) {
  return { mdRel, lineNo, kind, raw, level, reason };
}

function checkFile(absMd, findings) {
  const mdDir = path.dirname(absMd);
  const mdRel = path.relative(REPO_ROOT, absMd).replace(/\\/g, '/');
  let text;
  try {
    text = fs.readFileSync(absMd, 'utf-8');
  } catch {
    return;
  }
  const lines = text.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const lineNo = i + 1;

    // (1) Link markdown
    for (const m of line.matchAll(LINK_RE)) {
      const parsed = parsePathToken(m[1]);
      if (!parsed) continue;
      classify(mdRel, lineNo, 'link', m[0], parsed, mdDir, findings);
    }

    // (2) Ref inline code `path:line`
    for (const m of line.matchAll(INLINE_CODE_RE)) {
      const parsed = parseCodeRef(m[1]);
      if (!parsed) continue;
      classify(mdRel, lineNo, 'ref', '`' + m[1] + '`', parsed, mdDir, findings);
    }
  }
}

function classify(mdRel, lineNo, kind, raw, parsed, mdDir, findings) {
  const res = resolveTarget(parsed.path, mdDir);

  if (res.status === 'missing') {
    findings.push(
      makeFinding(mdRel, lineNo, kind, raw, 'ERROR', `không tìm thấy file '${parsed.path}'`),
    );
    return;
  }

  if (res.status === 'ambiguous') {
    // Basename tồn tại nhưng trùng nhiều nơi → không kết luận hỏng, nhưng nếu có
    // :line thì không soi chắc được. WARN để người đọc tự phân xử.
    if (parsed.line != null) {
      const rels = res.files.map((f) => path.relative(REPO_ROOT, f).replace(/\\/g, '/'));
      findings.push(
        makeFinding(mdRel, lineNo, kind, raw, 'WARN',
          `basename '${parsed.path}' trùng ${res.files.length} file, không soi được dòng ${parsed.line} (${rels.join(', ')})`),
      );
    }
    return;
  }

  // status === 'ok'
  if (parsed.line != null) {
    const total = lineCountOf(res.file);
    if (parsed.line < 1 || parsed.line > total) {
      const rel = path.relative(REPO_ROOT, res.file).replace(/\\/g, '/');
      findings.push(
        makeFinding(mdRel, lineNo, kind, raw, 'WARN',
          `dòng ${parsed.line} vượt số dòng của ${rel} (${total} dòng)`),
      );
    }
  }
}

// ─── Chọn tập file để quét ───────────────────────────────────────────────────

function defaultScanSet() {
  const set = [];
  // root/*.md (chỉ tầng trên cùng)
  for (const e of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      set.push(path.join(REPO_ROOT, e.name));
    }
  }
  // docs/**/*.md, bỏ docs/archive/**
  const docsDir = path.join(REPO_ROOT, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const f of walk(docsDir)) {
      const rel = path.relative(REPO_ROOT, f).replace(/\\/g, '/');
      if (!rel.toLowerCase().endsWith('.md')) continue;
      if (rel.startsWith('docs/archive/')) continue;
      set.push(f);
    }
  }
  return set;
}

// ─── main ────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const scanSet =
    argv.length > 0
      ? argv.map((a) => path.resolve(process.cwd(), a))
      : defaultScanSet();

  const findings = [];
  for (const f of scanSet) {
    if (isFile(f)) checkFile(f, findings);
    else console.error(`⚠️  bỏ qua (không phải file): ${f}`);
  }

  // In theo file .md.
  findings.sort((a, b) =>
    a.mdRel === b.mdRel ? a.lineNo - b.lineNo : a.mdRel.localeCompare(b.mdRel));

  let lastFile = null;
  let errors = 0;
  let warns = 0;
  for (const f of findings) {
    if (f.mdRel !== lastFile) {
      console.log(`\n${f.mdRel}`);
      lastFile = f.mdRel;
    }
    const tag = f.level === 'ERROR' ? 'ERROR' : 'WARN ';
    console.log(`  ${tag}  :${f.lineNo}  ${f.raw}  →  ${f.reason}`);
    if (f.level === 'ERROR') errors++;
    else warns++;
  }

  console.log(
    `\n${'─'.repeat(60)}\n` +
    `Đã quét ${scanSet.length} file .md · ${errors} ERROR · ${warns} WARN`,
  );
  if (errors > 0) {
    console.log('Có ERROR — thoát mã 1 (link/toạ độ trỏ vào file không tồn tại).');
    process.exit(1);
  }
  console.log('Không có ERROR — thoát mã 0.');
  process.exit(0);
}

main();
