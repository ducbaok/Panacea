// Bước 68 — Đợt 6 (#12): tags & categories
//
// ⚠️ ĐỌC TRƯỚC KHI SỬA FILE NÀY — CÁI BẪY LỚN NHẤT CỦA ĐỢT 6:
//
// Bảng `Tag` đã có sẵn 30 dòng và `Category` có 12 dòng TỪ TRƯỚC đợt này, do
// `seed-categories.ts` dựng. Nghĩa là hai query gốc `tags(query:…)` và
// `categories` TRẢ VỀ DỮ LIỆU ĐẦY ĐỦ ngay cả khi `_PinToTag` rỗng tuyệt đối và
// `Pin.tags` chưa nối được gì cả. Một bộ kiểm tra hỏi "query tags có trả về gì
// không" sẽ XANH TRỌN VẸN trên một bản cài đặt không gắn được một tag nào.
//
// Đây đúng hình dạng đã hại dự án bốn lần: KÝ HIỆU CÓ MẶT, CƠ CHẾ KHÔNG CÓ.
// Vì vậy bằng chứng của đợt này KHÔNG phải hai query gốc mà là:
//   `Pin.tags` đúng theo TỪNG pin — đối chiếu bản đồ đầy đủ 20 pin ↔ 43 cặp.
//
// ⚠️ BẪY 7 (bước 65 đã dính thật, xem §16): `gql(..., { expect })` chỉ phân
// loại lỗi KHI CÓ lỗi. Query THÀNH CÔNG thì harness ghi OK chứ không ghi FAIL.
// Ba phép "phải bị từ chối" ở đây (11 tag, 4 category, categoryId rác) lấy
// CHÍNH SỰ XUẤT HIỆN CỦA LỖI làm bằng chứng, nên dùng `expect` sẽ khiến chúng
// xanh vĩnh viễn đúng lúc cần đỏ. Tất cả đều dùng `h.silent` + `h.assert`.
//
// ⚠️ BẪY 8: mọi bằng chứng ở đây có hình dạng "danh sách rỗng / khác rỗng", mà
// một query BỊ TỪ CHỐI cũng cho ra đúng hình dạng đó. Nên mọi phép dưới đây
// đọc `errors` TRƯỚC `data`.
//
// ⚠️ `Category.id` là CUID, đổi sau mỗi lần re-seed — mà đợt này bắt buộc
// re-seed. Không hardcode id: mọi id category dùng ở đây đều ĐỌC QUA chính
// query `categories` rồi lọc theo `slug`.
//
// VỊ TRÍ 68: sau 67 (homeFeed đối chiếu số pin của john — pin do bước này tạo
// ra sẽ làm lệch phép đó nếu chạy trước), trước 70 (subscription cần cạnh
// `bao↔alice` còn sống; bước này không đụng quan hệ follow).
//
// NGÂN SÁCH PIN/NGÀY: bước này tạo 2 pin và cố ý dùng token của JOHN và ALICE
// chứ không phải bao. Trần 20 pin/ngày đếm cả pin đã soft-delete (bug thật,
// chưa sửa, có task riêng — xem README.md), mà bao đã tiêu 1 pin/lần chạy ở
// bước 10. Dồn thêm 2 pin nữa vào bao sẽ hạ số lần chạy được trong ngày từ
// ~16 xuống ~8. Cả hai pin đều được xoá ở cuối bước.

import { SEED_PIN_TAGS, SEED_PIN_CATEGORY_SLUGS, CATEGORY_SLUGS, isSeedPinId } from '../lib/seedrefs.mjs';
import { assertBatched } from '../lib/query-count.mjs';

/** Đọc thông điệp lỗi GraphQL, mở cả `originalError` của ValidationPipe. */
const errMsg = (r) => {
  const e = r?.errors?.[0];
  if (!e) return null;
  const raw = e.extensions?.originalError?.message ?? e.message;
  return Array.isArray(raw) ? raw.join('; ') : String(raw);
};

const errCode = (r) => r?.errors?.[0]?.extensions?.code ?? null;

/** So hai mảng chuỗi đã sắp xếp. */
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const FEED_TAXONOMY = `query($f:Int!){
  exploreFeed(first:$f){ items{ id tags{ id name } categories{ id slug } } }
}`;

const PIN_TAXONOMY = `query($id:ID!){
  pin(id:$id){ id tags{ id name } categories{ id slug } }
}`;

const PERF_Q = `query($f:Int!){
  exploreFeed(first:$f){ items{ id title tags{ name } categories{ slug } } }
}`;

const CREATE = `mutation($i:CreatePinInput!){ createPin(input:$i){ id } }`;
const UPDATE = `mutation($i:UpdatePinInput!){ updatePin(input:$i){ id } }`;

const img = () => ({
  imageUrl: 'https://localhost/taxonomy-probe.jpg',
  imageWidth: 64,
  imageHeight: 64,
});

export default async function (h) {
  const { state } = h;
  h.setGroup('GQL/taxonomy');

  // ─── Query gốc `categories` — CŨNG là cách lấy id hợp lệ ────────────────────
  //
  // Phép này yếu về mặt chứng minh đợt 6 (12 dòng đã có từ trước), nhưng nó
  // bắt buộc phải chạy TRƯỚC mọi thứ khác vì đây là nguồn DUY NHẤT hợp lệ để
  // biết `Category.id` sau lần re-seed gần nhất.
  const catRes = await h.silent(`{ categories { id name slug icon } }`, {}, state.T1);
  const cats = catRes?.data?.categories ?? [];
  const slugs = cats.map((c) => c.slug).sort();
  h.assert(
    'query `categories` trả đủ 12 danh mục biên tập, đúng bộ slug (khoá ổn định qua re-seed)',
    !catRes?.errors && sameList(slugs, [...CATEGORY_SLUGS].sort()) && cats.every((c) => c.id && c.name),
    errMsg(catRes) ? `LỖI: ${errMsg(catRes)}` : `${cats.length} category · slug: ${slugs.join(',')}`,
  );

  const idOf = (slug) => cats.find((c) => c.slug === slug)?.id;
  const travelId = idOf('travel');
  const foodId = idOf('food-drink');

  if (!travelId || !foodId) {
    h.rec('không đọc được Category.id qua query `categories`', 'FAIL', `travel=${travelId} food-drink=${foodId}`);
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHÉP KIỂM QUYẾT ĐỊNH của cả đợt
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Đối chiếu BẢN ĐỒ ĐẦY ĐỦ pin ↔ tag cho cả 20 pin seed, trong MỘT response.
  //
  // Vì sao không phải "có ít nhất một pin có tag": câu đó xanh với một loader
  // trả về CÙNG MỘT danh sách cho mọi key, và xanh cả với loader lệch thứ tự
  // (tag của pin_1 gán cho pin_2). Cả hai kiểu hỏng đều không crash, không
  // cảnh báo — chúng chỉ lặng lẽ sai. Đối chiếu từng cặp là thứ duy nhất phân
  // biệt được, và đó chính là bài học §13 (Đợt 4 bị ghi ✅ trong khi là 3 stub).
  //
  // Hai điều kiện tiên quyết `withTags > 0` và `empty > 0` KHÔNG phải trang
  // trí: chúng khẳng định CẢ HAI NHÁNH cùng có mặt trong response này. Thiếu
  // nhánh rỗng thì "loader trả mọi thứ" cũng xanh; thiếu nhánh khác rỗng thì
  // "loader trả `[]` cho mọi key" cũng xanh.
  const feedRes = await h.silent(FEED_TAXONOMY, { f: 50 }, state.T1);
  const feedErr = errMsg(feedRes);
  const seedItems = (feedRes?.data?.exploreFeed?.items ?? []).filter((i) => isSeedPinId(i.id));

  {
    const mismatches = [];
    for (const item of seedItems) {
      const got = item.tags.map((t) => t.name).sort();
      const want = SEED_PIN_TAGS[item.id];
      if (!want || !sameList(got, want)) {
        mismatches.push(`${item.id}: nhận[${got.join(',')}] ≠ chờ[${(want ?? ['?']).join(',')}]`);
      }
    }
    const withTags = seedItems.filter((i) => i.tags.length > 0).length;
    const empty = seedItems.filter((i) => i.tags.length === 0).length;
    const pairs = seedItems.reduce((n, i) => n + i.tags.length, 0);

    h.assert(
      'QUYẾT ĐỊNH: Pin.tags khớp ĐÚNG TỪNG PIN với bản đồ seed — 20 pin, cả nhánh có tag lẫn nhánh rỗng trong CÙNG một response',
      !feedErr &&
        seedItems.length === 20 &&
        withTags > 0 &&
        empty > 0 &&
        mismatches.length === 0,
      feedErr
        ? `LỖI: ${feedErr}`
        : `${seedItems.length}/20 pin seed · ${pairs} cặp pin↔tag · ${withTags} pin có tag · ${empty} pin RỖNG ` +
          `(${seedItems.filter((i) => i.tags.length === 0).map((i) => i.id).join(',') || 'không có'})` +
          (mismatches.length ? ` · LỆCH ${mismatches.length}: ${mismatches.slice(0, 4).join(' | ')}` : ''),
    );
  }

  // Cùng phép đó cho `categories`. KHÔNG gộp vào phép trên: gộp lại thì một
  // loader hỏng làm đỏ cả hai và ta mất khả năng đọc ra loader nào hỏng.
  //
  // Cặp đối chứng đắt nhất nằm ở đây: `pin_10` có tag RỖNG nhưng category
  // `travel`, còn `pin_19` có 2 tag nhưng category RỖNG. Một bản cài đặt trót
  // nối nhầm hai loader vào nhau (tags đọc quan hệ categories hoặc ngược lại)
  // sẽ xanh ở mọi phép "có dữ liệu không" nhưng đỏ ngay ở hai pin này.
  {
    const mismatches = [];
    for (const item of seedItems) {
      const got = item.categories.map((c) => c.slug).sort();
      const want = SEED_PIN_CATEGORY_SLUGS[item.id];
      if (!want || !sameList(got, want)) {
        mismatches.push(`${item.id}: nhận[${got.join(',')}] ≠ chờ[${(want ?? ['?']).join(',')}]`);
      }
    }
    const withCats = seedItems.filter((i) => i.categories.length > 0).length;
    const empty = seedItems.filter((i) => i.categories.length === 0).length;

    const p10 = seedItems.find((i) => i.id === 'pin_10_id');
    const p19 = seedItems.find((i) => i.id === 'pin_19_id');
    // Hai loader ĐỘC LẬP: pin_10 = (0 tag, 1 category), pin_19 = (2 tag, 0 category).
    const independent =
      p10?.tags.length === 0 && p10?.categories.length === 1 && p19?.tags.length === 2 && p19?.categories.length === 0;

    h.assert(
      'Pin.categories khớp ĐÚNG TỪNG PIN, và hai loader độc lập nhau (pin_10 = 0 tag/1 category, pin_19 = 2 tag/0 category)',
      !feedErr && seedItems.length === 20 && withCats > 0 && empty > 0 && independent && mismatches.length === 0,
      feedErr
        ? `LỖI: ${feedErr}`
        : `${withCats} pin có category · ${empty} pin rỗng · ` +
          `pin_10=(${p10?.tags.length} tag,${p10?.categories.length} cat) pin_19=(${p19?.tags.length} tag,${p19?.categories.length} cat)` +
          (mismatches.length ? ` · LỆCH ${mismatches.length}: ${mismatches.slice(0, 4).join(' | ')}` : ''),
    );
  }

  // ─── Chuẩn hoá tag ─────────────────────────────────────────────────────────
  //
  // ⚠️ DÙNG TAG MỚI (`design`), KHÔNG dùng một trong 30 tag seed. Với tag đã có
  // sẵn thì "chỉ sinh 1 dòng Tag" xanh vì dòng đó có từ trước, tức xanh VÌ LÝ
  // DO SAI. `design` không nằm trong 30 tag seed và không tag seed nào chứa
  // chuỗi con `design`, nên `tags(query:"design")` cô lập đúng thứ ta tạo ra.
  const A = await h.silent(
    CREATE,
    { i: { ...img(), title: 'taxonomy probe A', tagNames: ['Design', ' design ', 'DESIGN'], categoryIds: [travelId] } },
    state.T3,
  );
  const pinA = A?.data?.createPin?.id ?? null;

  if (!pinA) {
    h.rec('createPin (john) cho phép kiểm chuẩn hoá tag', 'FAIL', `không tạo được pin: ${errMsg(A) ?? 'không rõ'}`);
    return false;
  }

  const aRes = await h.silent(PIN_TAXONOMY, { id: pinA }, state.T3);
  const aTags = aRes?.data?.pin?.tags ?? [];
  const aCats = (aRes?.data?.pin?.categories ?? []).map((c) => c.slug);
  h.assert(
    'chuẩn hoá tag: createPin(["Design"," design ","DESIGN"]) ⇒ pin có ĐÚNG 1 tag `design` (không phải 3)',
    !errMsg(aRes) && aTags.length === 1 && aTags[0].name === 'design' && sameList(aCats, ['travel']),
    errMsg(aRes)
      ? `LỖI: ${errMsg(aRes)}`
      : `${aTags.length} tag [${aTags.map((t) => t.name).join(',')}] · category [${aCats.join(',')}]`,
  );

  // Pin thứ hai, CỦA NGƯỜI KHÁC, dùng lại đúng tag đó dưới dạng viết hoa.
  // Bằng chứng mạnh nhất cho "không sinh dòng Tag thứ hai" không phải số đếm
  // mà là `Tag.id` GIỐNG HỆT NHAU trên hai pin: số đếm bằng 1 có thể do query
  // lọc trùng, còn id trùng nhau thì chỉ có thể do cùng một hàng trong DB.
  const B = await h.silent(
    CREATE,
    { i: { ...img(), title: 'taxonomy probe B', tagNames: ['DESIGN'], categoryIds: [foodId] } },
    state.T2,
  );
  const pinB = B?.data?.createPin?.id ?? null;
  const bRes = pinB ? await h.silent(PIN_TAXONOMY, { id: pinB }, state.T2) : null;
  const bTags = bRes?.data?.pin?.tags ?? [];

  const tagsQ = await h.silent(`query($q:String!){ tags(query:$q, first:20){ id name } }`, { q: 'design' }, state.T1);
  const found = tagsQ?.data?.tags ?? [];

  h.assert(
    'dùng lại tag đã có (pin khác, user khác, viết HOA) ⇒ KHÔNG sinh dòng Tag thứ hai — cùng một Tag.id, và tags(query:"design") trả đúng 1 bản ghi',
    Boolean(pinB) &&
      !errMsg(bRes) &&
      bTags.length === 1 &&
      bTags[0].name === 'design' &&
      aTags[0]?.id === bTags[0]?.id &&
      found.length === 1 &&
      found[0].name === 'design',
    errMsg(B) || errMsg(bRes)
      ? `LỖI: ${errMsg(B) ?? errMsg(bRes)}`
      : `pinA.tag.id=${aTags[0]?.id} · pinB.tag.id=${bTags[0]?.id} · trùng=${aTags[0]?.id === bTags[0]?.id} · ` +
        `tags(query:"design") = ${found.length} bản ghi [${found.map((t) => t.name).join(',')}]`,
  );

  // ─── Ba giới hạn — bằng chứng LÀ sự xuất hiện của lỗi (bẫy 7) ───────────────

  {
    const many = Array.from({ length: 11 }, (_, i) => `probe-tag-${i}`);
    const r = await h.silent(CREATE, { i: { ...img(), tagNames: many } }, state.T3);
    const msg = errMsg(r);
    h.assert(
      '11 tag ⇒ BỊ TỪ CHỐI ở tầng validation (trần 10), và KHÔNG tạo pin nào',
      Boolean(msg) && /tagnames|10/i.test(msg) && !r?.data?.createPin,
      msg ? `ném đúng: ${msg.slice(0, 120)}` : `KHÔNG bị từ chối — đã tạo pin ${r?.data?.createPin?.id}`,
    );
  }

  {
    const four = [travelId, foodId, idOf('technology'), idOf('nature')];
    const r = await h.silent(CREATE, { i: { ...img(), categoryIds: four } }, state.T3);
    const msg = errMsg(r);
    h.assert(
      '4 categoryId ⇒ BỊ TỪ CHỐI ở tầng validation (trần 3), và KHÔNG tạo pin nào',
      Boolean(msg) && /categoryids|3/i.test(msg) && !r?.data?.createPin,
      msg ? `ném đúng: ${msg.slice(0, 120)}` : `KHÔNG bị từ chối — đã tạo pin ${r?.data?.createPin?.id}`,
    );
  }

  {
    // Phép quan trọng nhất trong ba: id rác phải thành 400 NGHIỆP VỤ, không
    // phải 500. Không dịch P2025 thì Prisma nổ lên tận GraphQL và lỗi của
    // NGƯỜI DÙNG bị báo cáo như sự cố của SERVER. Vì vậy phải khẳng định cả
    // thông điệp LẪN `extensions.code` — chỉ "có lỗi" thì một cú 500 cũng xanh.
    const r = await h.silent(CREATE, { i: { ...img(), categoryIds: ['khong-ton-tai'] } }, state.T3);
    const msg = errMsg(r);
    const code = errCode(r);
    h.assert(
      'categoryId không tồn tại ⇒ 400 nghiệp vụ "Unknown categoryId" (KHÔNG phải 500 / P2025 lọt ra ngoài)',
      Boolean(msg) &&
        /unknown categoryid/i.test(msg) &&
        code !== 'INTERNAL_SERVER_ERROR' &&
        !/prismaclient|invalid.*invocation/i.test(msg) &&
        !r?.data?.createPin,
      msg ? `code=${code} · ném đúng: ${msg.slice(0, 120)}` : `KHÔNG bị từ chối — đã tạo pin ${r?.data?.createPin?.id}`,
    );
  }

  // ─── updatePin: quy ước BA trạng thái ──────────────────────────────────────
  //
  // Ba phép riêng biệt, cố ý không gộp. `undefined` và `[]` là hai ý định KHÁC
  // NHAU mà chỉ khác nhau ở chỗ có hay không một khoá trong JSON — loại nhập
  // nhằng không bao giờ tự báo lỗi. Bản cài đặt lẫn hai trạng thái này xoá sạch
  // tag của người dùng mỗi lần họ sửa tiêu đề, và không log nào ghi lại.
  const tagsOf = async (id, token) => {
    const r = await h.silent(PIN_TAXONOMY, { id }, token);
    return {
      err: errMsg(r),
      tags: (r?.data?.pin?.tags ?? []).map((t) => t.name).sort(),
      cats: (r?.data?.pin?.categories ?? []).map((c) => c.slug).sort(),
    };
  };

  {
    const r = await h.silent(UPDATE, { i: { id: pinA, title: 'taxonomy probe A — đổi tiêu đề' } }, state.T3);
    const after = await tagsOf(pinA, state.T3);
    h.assert(
      'updatePin trạng thái 1/3 — KHÔNG gửi tagNames ⇒ tag GIỮ NGUYÊN (sửa tiêu đề không được xoá tag)',
      !errMsg(r) && !after.err && sameList(after.tags, ['design']) && sameList(after.cats, ['travel']),
      errMsg(r) ? `LỖI: ${errMsg(r)}` : `tag [${after.tags.join(',')}] · category [${after.cats.join(',')}]`,
    );
  }

  {
    const r = await h.silent(UPDATE, { i: { id: pinA, tagNames: ['Alpha', ' BETA '] } }, state.T3);
    const after = await tagsOf(pinA, state.T3);
    h.assert(
      'updatePin trạng thái 2/3 — gửi ["Alpha"," BETA "] ⇒ THAY THẾ TOÀN BỘ (design biến mất), đã chuẩn hoá, category KHÔNG bị đụng',
      !errMsg(r) && !after.err && sameList(after.tags, ['alpha', 'beta']) && sameList(after.cats, ['travel']),
      errMsg(r) ? `LỖI: ${errMsg(r)}` : `tag [${after.tags.join(',')}] · category [${after.cats.join(',')}]`,
    );
  }

  {
    const r = await h.silent(UPDATE, { i: { id: pinA, tagNames: [] } }, state.T3);
    const after = await tagsOf(pinA, state.T3);
    h.assert(
      'updatePin trạng thái 3/3 — gửi [] ⇒ XOÁ HẾT tag, category vẫn còn nguyên (phân biệt được [] với không-gửi)',
      !errMsg(r) && !after.err && after.tags.length === 0 && sameList(after.cats, ['travel']),
      errMsg(r) ? `LỖI: ${errMsg(r)}` : `tag [${after.tags.join(',')}] (${after.tags.length}) · category [${after.cats.join(',')}]`,
    );
  }

  {
    const r = await h.silent(UPDATE, { i: { id: pinA, categoryIds: [] } }, state.T3);
    const after = await tagsOf(pinA, state.T3);
    h.assert(
      'updatePin: categoryIds:[] ⇒ xoá hết category (quy ước ba trạng thái áp dụng cho CẢ HAI quan hệ, không riêng tag)',
      !errMsg(r) && !after.err && after.cats.length === 0,
      errMsg(r) ? `LỖI: ${errMsg(r)}` : `category [${after.cats.join(',')}] (${after.cats.length})`,
    );
  }

  // ─── Số query bất biến theo kích thước trang ───────────────────────────────
  //
  // Mặc định 5/20 DÙNG ĐƯỢC ở đây (khác Đợt 5 phải hạ xuống 2/8): `exploreFeed`
  // lúc này có >20 pin còn sống (20 seed + pin của bước 10 + 2 pin của bước
  // này), nên trang lớn THẬT SỰ chứa gấp 4 lần số item — điều kiện để Δ=0 có
  // nghĩa. Nếu trang lớn không lớn hơn thật thì Δ=0 là xanh giả kể cả với code
  // N+1 hoàn toàn (bẫy 3).
  h.setGroup('GQL/perf');
  await assertBatched(
    h,
    h.counter,
    'exploreFeed + tags + categories: số query bất biến theo kích thước trang',
    (first) => h.silent(PERF_Q, { f: first }, state.T1),
    { small: 5, large: 20 },
  );

  h.setGroup('GQL/taxonomy');

  // ─── Tự dọn 2 pin đã tạo ───────────────────────────────────────────────────
  //
  // KHÔNG phải dọn dẹp trang trí. Để lại thì (a) `exploreFeed` phình thêm 2 pin
  // mỗi lần chạy và các phép đối chiếu tập hợp ở bước 67 sẽ lệch dần, (b) trần
  // 20 pin/ngày bị tiêu nhanh hơn. Có hẳn một bản ghi khẳng định việc dọn đã
  // xong, vì dọn thất bại âm thầm là thứ chỉ lộ ra sau vài lần chạy.
  const delA = await h.silent(`mutation($id:ID!){ deletePin(id:$id){ id } }`, { id: pinA }, state.T3);
  const delB = await h.silent(`mutation($id:ID!){ deletePin(id:$id){ id } }`, { id: pinB }, state.T2);

  const back = await h.silent(FEED_TAXONOMY, { f: 50 }, state.T1);
  const leftover = (back?.data?.exploreFeed?.items ?? []).filter((i) => i.id === pinA || i.id === pinB);

  const cleaned = !errMsg(delA) && !errMsg(delB) && leftover.length === 0;
  h.assert(
    'đã xoá 2 pin do bước này tạo (giữ exploreFeed đúng kích thước cho lần chạy sau + tiết kiệm trần 20 pin/ngày)',
    cleaned,
    cleaned
      ? `đã xoá ${pinA}, ${pinB}`
      : `CÒN SÓT ${leftover.length} pin · delA=${errMsg(delA) ?? 'ok'} delB=${errMsg(delB) ?? 'ok'}`,
  );

  return cleaned;
}
