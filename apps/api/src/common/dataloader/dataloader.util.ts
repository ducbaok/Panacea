// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  dataloader.util.ts — 4 helper thuần cho phần "map lại theo thứ tự keys"  ║
// ║                                                                          ║
// ║  HỢP ĐỒNG CỦA DATALOADER mà cả 4 helper này tồn tại để bảo vệ:           ║
// ║  hàm batch PHẢI trả về mảng CÙNG ĐỘ DÀI và CÙNG THỨ TỰ với `keys`.       ║
// ║  Database trả về ít dòng hơn (thiếu bản ghi) và theo thứ tự khác. Viết   ║
// ║  tay phép map đó ở 10 chỗ là 10 cơ hội lệch thứ tự — mà lệch thứ tự thì  ║
// ║  KHÔNG crash, nó chỉ lặng lẽ gán dữ liệu của A cho B.                    ║
// ║                                                                          ║
// ║  CỐ Ý KHÔNG trừu tượng hoá phần query: mỗi loader vẫn nhìn thấy nguyên   ║
// ║  câu Prisma của nó. Chỉ phần lặp lại một cách máy móc mới gom vào đây.   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/**
 * Map kết quả `groupBy` + `_count` về đúng thứ tự `keys`. Key không có dòng
 * nào ⇒ `0` (Prisma bỏ hẳn nhóm rỗng khỏi kết quả, không trả count = 0).
 *
 * `field` vừa là khoá gom nhóm vừa là khoá đếm — đúng với cả 6 loader đang
 * dùng, vì tất cả đều `by: [f]` + `_count: { [f]: true }`.
 *
 * Chịu được key NULL: `pinCountByBoardIdLoader` gom theo `SavedPin.boardId`
 * vốn nullable (pin đã lưu nhưng chưa xếp vào board nào), nên Prisma có thể
 * trả về một nhóm `boardId = null`. Nhóm đó không thuộc về key nào và phải bị
 * bỏ qua — nếu để lọt vào Map nó sẽ không khớp key nào, nhưng bỏ luôn cho rõ ý.
 */
export function mapCounts<K extends PropertyKey, F extends string>(
  keys: readonly K[],
  rows: readonly (Record<F, K | null> & { _count: Record<F, number> })[],
  field: F,
): number[] {
  const map = new Map<K, number>();
  for (const row of rows) {
    const key = row[field];
    if (key != null) map.set(key, row._count[field]);
  }
  return keys.map((key) => map.get(key) ?? 0);
}

/**
 * Gom các dòng con về từng key cha (quan hệ 1-nhiều). Key không có dòng nào ⇒
 * mảng RỖNG, không phải `null`: GraphQL field kiểu `[T!]!` mà nhận `null` sẽ
 * ném lỗi non-nullable ngay tại runtime.
 *
 * Giữ nguyên thứ tự dòng do query trả về, nên `orderBy` ở tầng Prisma vẫn có
 * hiệu lực bên trong từng nhóm (ví dụ `sections` sắp theo `sortOrder`).
 */
export function groupRows<K, R>(keys: readonly K[], rows: readonly R[], keyOf: (row: R) => K): R[][] {
  const map = new Map<K, R[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return keys.map((key) => map.get(key) ?? []);
}

/**
 * "Key này có xuất hiện trong kết quả không?" — dùng cho các loader boolean.
 * Query chỉ trả về những dòng THOẢ điều kiện, nên có mặt = true, vắng = false.
 */
export function mapExists<K, R>(keys: readonly K[], rows: readonly R[], keyOf: (row: R) => K): boolean[] {
  const found = new Set<K>(rows.map(keyOf));
  return keys.map((key) => found.has(key));
}

/**
 * Map 1-1 từ key sang bản ghi. Không tìm thấy ⇒ `null` (KHÔNG phải `undefined`,
 * cũng không phải ném lỗi): id trỏ vào bản ghi đã xoá là chuyện bình thường,
 * và `undefined` sẽ làm DataLoader hiểu nhầm là lỗi hợp đồng độ dài.
 *
 * ⚠️ Helper này CHỈ map, không lọc. `pinByIdLoader` cố ý không lọc `deletedAt`
 * ở câu query mà dựa vào Prisma middleware — đừng thêm phép lọc vào đây, làm
 * vậy là đổi hành vi của loader đó mà không ai thấy.
 */
export function mapValues<K, V>(keys: readonly K[], rows: readonly V[], keyOf: (row: V) => K): (V | null)[] {
  const map = new Map<K, V>(rows.map((row) => [keyOf(row), row]));
  return keys.map((key) => map.get(key) ?? null);
}
