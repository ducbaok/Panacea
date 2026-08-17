/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  pubsub-serde — giữ nguyên kiểu `Date` khi payload đi qua Redis PubSub    ║
 * ║                                                                          ║
 * ║  BUG THẬT ĐÃ ĐO ĐƯỢC (17/08/2026, do FE-8 phát hiện):                    ║
 * ║                                                                          ║
 * ║    subscription{ notificationReceived{ id type createdAt } }             ║
 * ║    → next { data: null, errors: [                                        ║
 * ║        "Expected `DateTime.serialize(\"2026-08-17T00:48:06.625Z\")` to    ║
 * ║         return non-nullable value, returned: null" ] }                   ║
 * ║                                                                          ║
 * ║  `messageReceived{ createdAt }` **cùng bệnh, cùng thông điệp** — nên đây  ║
 * ║  KHÔNG phải bug của notification, mà của cả tầng vận chuyển.             ║
 * ║                                                                          ║
 * ║  NGUYÊN NHÂN GỐC — ba mảnh ghép lại:                                     ║
 * ║   1. `RedisPubSub` mặc định vận chuyển bằng `JSON.stringify` (publish) +  ║
 * ║      `JSON.parse` (nhận). JSON **không có kiểu ngày**: `Date` bị          ║
 * ║      `toJSON()` ép thành chuỗi ISO và **không có đường về**.             ║
 * ║   2. Scalar `DateTime` của @nestjs/graphql (`iso-date.scalar.js:11`):    ║
 * ║        serialize(value) { return value instanceof Date ? … : null }      ║
 * ║      Chuỗi ISO KHÔNG phải `Date` ⇒ trả thẳng `null`.                     ║
 * ║   3. Mọi field ngày trong SDL đều là `DateTime!` (non-null) ⇒ `null`     ║
 * ║      thành lỗi thực thi, và vì nó nằm trên nhánh subscription nên cả     ║
 * ║      frame `next` mất sạch `data`.                                       ║
 * ║                                                                          ║
 * ║  ⚠️ Query/mutation KHÔNG dính vì payload của chúng đi thẳng từ Prisma ra  ║
 * ║  resolver trong cùng một tiến trình — `Date` chưa từng qua JSON. Đó là    ║
 * ║  lý do bug sống sót qua 223 phép verify: **chỉ đường PubSub mới hỏng**.  ║
 * ║                                                                          ║
 * ║  VÌ SAO VÁ Ở ĐÂY CHỨ KHÔNG Ở NOTIFICATION:                               ║
 * ║  vá riêng một service là vá một triệu chứng — subscription thứ ba viết   ║
 * ║  sau này sẽ mắc lại y hệt. Tầng serde là chỗ DUY NHẤT mà mọi payload     ║
 * ║  đều đi qua.                                                             ║
 * ║                                                                          ║
 * ║  VÌ SAO GẮN THẺ CHỨ KHÔNG DÙNG `reviver` ĐOÁN CHUỖI ISO:                 ║
 * ║  `RedisPubSub` có sẵn option `reviver`, và cách phổ biến là regex bắt    ║
 * ║  chuỗi hình dạng ISO rồi `new Date(...)`. Cách đó **đoán mò**: một tin   ║
 * ║  nhắn có `content = "2020-01-01T00:00:00.000Z"` (người dùng gõ được)     ║
 * ║  sẽ bị biến thành `Date`, và scalar `String` lại ném lỗi ngược lại —     ║
 * ║  đổi một bug lấy một bug hiếm hơn, khó thấy hơn. Ở đây ta ghi lại        ║
 * ║  **sự thật đã biết lúc publish** (`value instanceof Date`) thay vì suy    ║
 * ║  đoán lúc nhận, nên không có cả dương tính giả lẫn âm tính giả.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * Khoá đánh dấu một giá trị đã từng là `Date`.
 *
 * Chọn `$date` (giống MongoDB Extended JSON) vì nó không thể va với tên field
 * của Prisma: `$` không hợp lệ trong tên cột/quan hệ. Object bọc chỉ có ĐÚNG
 * một khoá — điều kiện đó được kiểm lúc giải mã để một object nghiệp vụ lỡ có
 * khoá `$date` kèm khoá khác không bị nuốt nhầm.
 */
export const DATE_TAG = '$date';

/**
 * `JSON.stringify` với replacer đọc `this[key]` chứ không đọc `value`.
 *
 * ⚠️ Đây là chỗ dễ viết sai nhất của cả file. Theo spec, `JSON.stringify` gọi
 * `value.toJSON()` **TRƯỚC** rồi mới đưa kết quả cho replacer ⇒ tham số
 * `value` của replacer đã là **chuỗi ISO**, `value instanceof Date` luôn sai.
 * Bản gốc chưa qua `toJSON` chỉ còn ở `this[key]` (`this` là object/mảng chứa
 * nó). Vì cần `this`, replacer BẮT BUỘC là `function`, không được là arrow.
 */
export function serializePubSubPayload(payload: unknown): string {
  return JSON.stringify(payload, function (this: Record<string, unknown>, key: string, value: unknown) {
    return this[key] instanceof Date ? { [DATE_TAG]: value } : value;
  });
}

/**
 * Nghịch đảo của `serializePubSubPayload`.
 *
 * `RedisPubSub` gọi deserializer với `Buffer.from(message)`
 * (`redis-pubsub.js:142`), không phải string — nhận cả hai cho chắc.
 */
export function deserializePubSubPayload(raw: Buffer | string): unknown {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  return JSON.parse(text, (_key: string, value: unknown) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const box = value as Record<string, unknown>;
      const iso = box[DATE_TAG];
      // `length === 1`: chỉ mở hộp do chính ta gói, không đụng object nghiệp vụ.
      if (typeof iso === 'string' && Object.keys(box).length === 1) return new Date(iso);
    }
    return value;
  });
}
