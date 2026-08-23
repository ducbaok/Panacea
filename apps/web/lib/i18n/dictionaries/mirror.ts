/**
 * Mirror<T> — buộc từ điển `en` phải phủ ĐÚNG bộ key của từ điển `vi`.
 *
 * `Record<keyof T, string>` bắt hai lỗi ở thì biên dịch:
 *   • thiếu key  → "Property 'x' is missing"
 *   • thừa key   → excess property check trên object literal
 *
 * Đây là lý do vi là NGUỒN key duy nhất: thêm chuỗi mới ở vi mà quên en thì
 * `pnpm --filter web build` đỏ ngay, không âm thầm rơi về tiếng Việt.
 */
export type Mirror<T> = Record<keyof T, string>;
