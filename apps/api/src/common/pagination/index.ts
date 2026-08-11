// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Pagination barrel export                                                ║
// ║                                                                          ║
// ║  `cursor-pagination` = 3 helper cũ (`buildCursorFilter`,                 ║
// ║  `buildCursorOrderBy`, `toPaginatedResult`) + encode/decode 2-thành-phần.║
// ║  `keysets` = KeysetSpec n-thành-phần cho consumer mới (Đợt 1a).         ║
// ║                                                                          ║
// ║  Cả hai `export *` cùng lúc — không có tên đụng nhau (mỗi bên có một     ║
// ║  `encodeCursor*` khác chữ ký). Xem header của keysets.ts để biết khi     ║
// ║  nào chọn `keysetWhere` vs `buildCursorFilter`.                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
export * from './cursor-pagination';
export * from './keysets';
