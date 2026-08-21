// Bước 65 — Đợt 3e (#16): lọc blocked user trên PinsService
//
// ⚠️ VỊ TRÍ CỦA BƯỚC NÀY LÀ HỢP ĐỒNG, KHÔNG PHẢI SỞ THÍCH.
//
// `blockUser` xoá quan hệ follow CẢ HAI CHIỀU (social.service.ts:104) và
// `unblockUser` KHÔNG khôi phục lại. Bộ verify phụ thuộc vào các cạnh follow
// của seed, nên bước này:
//
//   1. chạy SAU bước 20 (nơi dựng mutual follow bao↔alice mà bước 50/70 cần),
//   2. block JOHN chứ không phải alice — cạnh bao↔alice là tiền đề cứng của DM
//      và subscription; cạnh john→alice (luật mutual-follow ở bước 50) không bị
//      đụng vì block chỉ xoá cạnh GIỮA HAI BÊN,
//   3. tự dựng lại 2 cạnh bao↔john trước khi kết thúc. Thiếu bước này thì lần
//      chạy KẾ TIẾP sẽ đỏ ở `followers` của bước 20 — cách xa nguyên nhân.
//
// ⚠️ BẪY 7 (đã dính thật lúc soạn đợt này): mọi bằng chứng ở đây có hình dạng
// "item biến mất", mà một query BỊ TỪ CHỐI cũng cho ra đúng hình dạng đó —
// `(res.data?.userPins?.items ?? []).length` in ra `0` khi query LỖI, không
// phải khi lọc thành công. Nên mọi phép kiểm dưới đây khẳng định `errors` vắng
// mặt song song với việc đếm item. Cụ thể `userPins` khai `userId: ID!`
// (pins.resolver.ts:93) — truyền `String!` là query bị từ chối, trông y hệt một
// bộ lọc hoàn hảo.

import { USERS } from '../lib/seedrefs.mjs';
import { assertBatched } from '../lib/query-count.mjs';

/**
 * Đếm số câu query chạm bảng `BlockedUser` mà `fn` sinh ra.
 *
 * ⚠️ ĐỌC LOG THEO BYTE, KHÔNG THEO KÝ TỰ (bẫy 4). `statSync().size` là byte còn
 * `String.slice` cắt theo UTF-16 code unit; log có emoji + tiếng Việt nên cắt
 * bằng chuỗi sẽ đếm THIẾU — và lỗi nghiêng về phía làm ta TIN là đã tối ưu tốt
 * hơn sự thật, tức là hướng nguy hiểm nhất.
 *
 * ⚠️ ĐẾM `FROM "public"."BlockedUser"`, KHÔNG ĐẾM `"BlockedUser"`. Prisma log
 * nguyên văn câu SQL, trong đó tên bảng xuất hiện MỘT LẦN CHO MỖI CỘT được
 * select cộng thêm mệnh đề FROM và WHERE — một query duy nhất của
 * `getBlockedUserIds` cho ra 7 lần khớp. Đếm chuỗi trần khiến bản đo đầu tiên
 * của đợt này báo "7 query" cho đúng 1 query (xem debug_history §16).
 *
 * ⚠️ 17/08/2026 — DÙNG LẠI `counter.measure` THAY CHO BẢN ĐẾM RIÊNG. Bản cũ
 * chờ stdout bằng `sleep(250)` cứng; nay `measure()` chờ tới khi file log
 * NGỪNG LỚN. Đây là ứng viên số một cho hình dạng FAIL "trôi" đo được sau FE-6
 * (phép này ra **0** thay vì 1): 0 query BlockedUser là chuyện không thể xảy ra
 * khi query trả về dữ liệu, nên nó là lỗi ĐO chứ không phải lỗi memo. Xem thêm
 * nhánh chống-xanh-giả mới trong `assertBatched`.
 */
async function countBlockedUserQueries(h, fn) {
  const { result, queries } = await h.counter.measure(fn, /FROM "public"\."BlockedUser"/g);
  return { result, n: queries };
}

/** 4 pin của mỗi user trong seed — liền khối, kiểm bằng truy vấn thẳng vào DB. */
const JOHN_PINS = ['pin_9_id', 'pin_10_id', 'pin_11_id', 'pin_12_id'];
const BAO_PINS = ['pin_1_id', 'pin_2_id', 'pin_3_id', 'pin_4_id'];
/** Title chứa "Sunset" khớp ĐÚNG một pin trong toàn bộ seed: pin_10_id của john. */
const SUNSET_PIN = 'pin_10_id';
/** Pin của alice — người không liên quan tới cặp block, dùng để bắt lỗi lọc quá tay. */
const ALICE_PIN = 'pin_13_id';

const Q_EXPLORE = `query($f:Int!){ exploreFeed(first:$f){ items{ id } } }`;
const Q_USERPINS = `query($u:ID!,$f:Int!){ userPins(userId:$u, first:$f){ items{ id } } }`;
const Q_PIN = `query($id:ID!){ pin(id:$id){ id title } }`;
const Q_SEARCH = `query($q:String!,$t:SearchType!){ search(query:$q, type:$t, first:20){ pins{ items{ id } } } }`;

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/blocking');

  /** Đọc feed và trả về CẢ lỗi lẫn danh sách id — không bao giờ nuốt errors. */
  const feed = async (token) => {
    const r = await h.silent(Q_EXPLORE, { f: 50 }, token);
    return { err: r?.errors?.[0]?.message ?? null, ids: (r?.data?.exploreFeed?.items ?? []).map((i) => i.id) };
  };
  const pinsOf = async (userId, token) => {
    const r = await h.silent(Q_USERPINS, { u: userId, f: 50 }, token);
    return { err: r?.errors?.[0]?.message ?? null, ids: (r?.data?.userPins?.items ?? []).map((i) => i.id) };
  };
  const searchSunset = async (token) => {
    const r = await h.silent(Q_SEARCH, { q: 'Sunset', t: 'PIN' }, token);
    return { err: r?.errors?.[0]?.message ?? null, ids: (r?.data?.search?.pins?.items ?? []).map((i) => i.id) };
  };

  // ─── Tiền đề: phải có thứ gì đó ĐỂ MẤT ─────────────────────────────────────
  // Không có dòng này thì "feed không chứa pin của john" cũng có thể đúng vì
  // john chẳng có pin nào, hoặc vì feed rỗng.
  const feedBefore = await feed(state.T1);
  const johnBefore = await pinsOf(USERS.john.id, state.T1);
  const sunsetBefore = await searchSunset(state.T1);

  h.assert(
    'tiền đề: trước khi block, bao thấy đủ 4 pin của john (feed · userPins · search)',
    !feedBefore.err &&
      !johnBefore.err &&
      JOHN_PINS.every((p) => feedBefore.ids.includes(p)) &&
      johnBefore.ids.length === 4 &&
      sunsetBefore.ids.length === 1,
    `feed=${feedBefore.ids.length} pin (đủ 4 của john) · userPins(john)=${johnBefore.ids.length} · search("Sunset")=${sunsetBefore.ids.join(',') || 'rỗng'}`,
  );

  // ─── Block ─────────────────────────────────────────────────────────────────
  h.setGroup('GQL/mut');
  await gql('blockUser (bao → john)', `mutation($u:String!){ blockUser(userId:$u) }`, { u: USERS.john.id }, { token: state.T1 });

  h.setGroup('GQL/blocking');

  // ─── ĐỐI CHỨNG (không phải phép kiểm của đợt này) ──────────────────────────
  // SearchService đã lọc blocked user từ trước 3e. Nó chứng minh bản ghi block
  // THẬT SỰ nằm trong DB tại đúng thời điểm này. Không có nó thì một feed thiếu
  // pin cũng có thể chỉ là block chưa kịp ghi — đúng kiểu mơ hồ mà §13/§15 dạy
  // phải loại trừ.
  const sunsetAfter = await searchSunset(state.T1);
  h.assert(
    'ĐỐI CHỨNG: search("Sunset") của bao về 0 ⇒ bản ghi block đã nằm trong DB',
    !sunsetAfter.err && sunsetAfter.ids.length === 0,
    `trước block=${sunsetBefore.ids.join(',') || 'rỗng'} · sau block=${sunsetAfter.ids.join(',') || 'rỗng'}${sunsetAfter.err ? ` · LỖI: ${sunsetAfter.err}` : ''}`,
  );

  // ─── Call-site 1/3: exploreFeed ────────────────────────────────────────────
  const feedAfter = await feed(state.T1);
  const stillThere = JOHN_PINS.filter((p) => feedAfter.ids.includes(p));
  h.assert(
    'exploreFeed của bao mất ĐÚNG 4 pin của john',
    !feedAfter.err && stillThere.length === 0 && feedBefore.ids.length - feedAfter.ids.length === 4,
    `${feedBefore.ids.length} → ${feedAfter.ids.length} pin (Δ=${feedBefore.ids.length - feedAfter.ids.length})` +
      (stillThere.length ? ` · CÒN SÓT: ${stillThere.join(',')}` : '') +
      (feedAfter.err ? ` · LỖI: ${feedAfter.err}` : ''),
  );

  // Lọc quá tay cũng là một cách hỏng: "mất pin của john" xanh trọn vẹn ngay cả
  // khi feed mất luôn pin của mọi người khác.
  h.assert(
    'exploreFeed vẫn giữ pin của bao và của người không liên quan (không lọc quá tay)',
    BAO_PINS.every((p) => feedAfter.ids.includes(p)) && feedAfter.ids.includes(ALICE_PIN),
    `pin của bao: ${BAO_PINS.filter((p) => feedAfter.ids.includes(p)).length}/4 · pin_13_id (alice): ${feedAfter.ids.includes(ALICE_PIN) ? 'còn' : 'MẤT'}`,
  );

  // ─── Call-site 2/3: userPins ───────────────────────────────────────────────
  const johnAfter = await pinsOf(USERS.john.id, state.T1);
  h.assert(
    'userPins(john) theo bao trả trang RỖNG và KHÔNG ném lỗi',
    johnAfter.err === null && johnAfter.ids.length === 0,
    johnAfter.err ? `NÉM LỖI (phải trả rỗng): ${johnAfter.err}` : `${johnBefore.ids.length} → 0 pin, không lỗi`,
  );

  // ─── Call-site 3/3: pin(id) — lỗ hổng nghiêm trọng nhất ────────────────────
  // Feed lọc đúng mà chỗ này quên lọc thì mở thẳng link pin là lách được, và
  // không phép kiểm nào của feed phát hiện ra.
  // ⚠️ KHÔNG DÙNG `gql(..., { expect })` Ở ĐÂY. `expect` chỉ phân loại lỗi KHI
  // CÓ lỗi: nếu query THÀNH CÔNG thì `gql` ghi OK, không ghi FAIL. Với phép
  // kiểm mà bằng chứng LÀ sự xuất hiện của lỗi, hình dạng đó xanh vĩnh viễn
  // đúng lúc nó cần đỏ. Đối chứng âm của đợt này bắt được: bỏ một nhánh `OR`
  // làm phép kiểm `pin` chiều ngược tụt từ EXPECTED xuống OK chứ không FAIL
  // (xem debug_history §16). Nên ở đây khẳng định TƯỜNG MINH là phải có lỗi.
  const pinBlocked = await h.silent(Q_PIN, { id: SUNSET_PIN }, state.T1);
  h.assert(
    'pin(pin_10_id) theo bao → NotFound (không lách được bằng link trực tiếp)',
    /not found/i.test(pinBlocked?.errors?.[0]?.message ?? '') && !pinBlocked?.data?.pin,
    pinBlocked?.errors?.[0]?.message
      ? `ném đúng: ${pinBlocked.errors[0].message}`
      : `KHÔNG ném lỗi — vẫn đọc được pin qua link trực tiếp: ${JSON.stringify(pinBlocked?.data?.pin)}`,
  );

  // ─── Chiều ngược lại — người BỊ chặn cũng không thấy người chặn ────────────
  // `getBlockedUserIds` phủ cả hai vai bằng `OR`. Bỏ một nhánh vẫn biên dịch
  // sạch và toàn bộ phần trên vẫn xanh; chỉ 3 phép kiểm dưới đây bắt được.
  const feedJohn = await feed(state.T3);
  const baoStillThere = BAO_PINS.filter((p) => feedJohn.ids.includes(p));
  h.assert(
    '2 CHIỀU: exploreFeed của john cũng mất 4 pin của bao (người bị chặn)',
    !feedJohn.err && baoStillThere.length === 0,
    baoStillThere.length ? `CÒN SÓT: ${baoStillThere.join(',')}` : `${feedJohn.ids.length} pin, không còn pin nào của bao`,
  );

  const baoByJohn = await pinsOf(USERS.bao.id, state.T3);
  h.assert(
    '2 CHIỀU: userPins(bao) theo john trả trang RỖNG',
    baoByJohn.err === null && baoByJohn.ids.length === 0,
    baoByJohn.err ? `NÉM LỖI: ${baoByJohn.err}` : '0 pin, không lỗi',
  );

  const pinBlockedRev = await h.silent(Q_PIN, { id: BAO_PINS[0] }, state.T3);
  h.assert(
    '2 CHIỀU: pin(pin_1_id) theo john → NotFound',
    /not found/i.test(pinBlockedRev?.errors?.[0]?.message ?? '') && !pinBlockedRev?.data?.pin,
    pinBlockedRev?.errors?.[0]?.message
      ? `ném đúng: ${pinBlockedRev.errors[0].message}`
      : `KHÔNG ném lỗi — người bị chặn vẫn đọc được pin: ${JSON.stringify(pinBlockedRev?.data?.pin)}`,
  );

  // ─── Call-site 4/4: relatedPins (B-11, 17/08/2026) ─────────────────────────
  //
  // ⚠️ `relatedPins` có HAI chỗ phải lọc, không phải một — và chỗ thứ hai là
  // chỗ dễ quên nhất:
  //   (a) pin KẾT QUẢ: giống 3 call-site trên;
  //   (b) pin GỐC: nếu không lọc, người bị chặn vẫn "gợi ý" được nội dung —
  //       viewer đưa pinId của họ vào và nhận về một dải pin sinh ra từ tag của
  //       pin đó. Lỗ này vô hình với mọi phép kiểm chỉ nhìn danh sách trả về,
  //       vì danh sách đó toàn pin hợp lệ.
  //
  // `pin_18_id` (của bob) chọn làm pin gốc vì nó có tag chung với **cả 3 pin
  // của john** lẫn pin của alice/bob ⇒ đo được Δ chính xác chứ không phải
  // "rỗng hết".
  {
    const RELATED = `query($p:ID!){ relatedPins(pinId:$p, first:20){ items{ id } } }`;
    const rel = await h.silent(RELATED, { p: 'pin_18_id' }, state.T1);
    const relIds = (rel?.data?.relatedPins?.items ?? []).map((x) => x.id);
    const johnLeft = JOHN_PINS.filter((p) => relIds.includes(p));
    h.assert(
      'relatedPins(pin_18) theo bao: mất pin của john, GIỮ pin của người khác (không lọc quá tay)',
      !rel?.errors && johnLeft.length === 0 && relIds.length > 0,
      rel?.errors
        ? `LỖI: ${rel.errors[0].message}`
        : `còn ${relIds.length} pin [${relIds.join(',')}]` +
            (johnLeft.length ? ` · CÒN SÓT của john: ${johnLeft.join(',')}` : ''),
    );

    // (b) PIN GỐC bị chặn ⇒ rỗng. Dùng pin của bao, xem bằng token john.
    const relSrcBlocked = await h.silent(RELATED, { p: BAO_PINS[0] }, state.T3);
    h.assert(
      '2 CHIỀU: relatedPins với PIN GỐC của người đã chặn mình ⇒ rỗng (không gợi ý vòng qua tag)',
      !relSrcBlocked?.errors && (relSrcBlocked?.data?.relatedPins?.items ?? []).length === 0,
      relSrcBlocked?.errors
        ? `LỖI: ${relSrcBlocked.errors[0].message}`
        : `${(relSrcBlocked?.data?.relatedPins?.items ?? []).length} item (phải 0)`,
    );
  }

  // ─── Khách vãng lai — bắt lỗi `NOT IN ()` và lỗi "lọc nhầm thành lọc tất" ──
  // Mảng rỗng KHÔNG phải biên hiếm: đó là đường đi của mọi request không token
  // và của mọi người chưa chặn ai. `NOT IN ()` là lỗi cú pháp SQL, sẽ nổ thành
  // 500 ngay tại đây.
  const feedAnon = await feed(undefined);
  h.assert(
    'khách vãng lai: exploreFeed vẫn 200 và KHÔNG mất pin nào (mảng rỗng ⇒ bỏ hẳn mệnh đề NOT IN)',
    !feedAnon.err && feedAnon.ids.length === feedBefore.ids.length,
    feedAnon.err ? `LỖI: ${feedAnon.err}` : `${feedAnon.ids.length} pin (bằng đúng feed của bao trước khi block)`,
  );

  // ─── Số query: memo phải giữ 1 query BlockedUser cho CẢ request ────────────
  // Probe này KHÔNG đỏ-trước được — trước khi sửa chẳng có query BlockedUser
  // nào. Nó là phép kiểm chéo: sẽ bắt được nếu về sau ai đó bỏ memo và gọi
  // `getBlockedUserIds` một lần cho mỗi resolver.
  // Seed có 20 pin nên trang lớn THẬT SỰ chứa nhiều item hơn trang nhỏ ⇒ 5/20
  // dùng được ở đây (khác `followers` của bước 20, vốn phải hạ xuống 1/4).
  h.setGroup('GQL/perf');
  await assertBatched(
    h,
    h.counter,
    'exploreFeed (đang block): số query bất biến theo kích thước trang',
    (first) => h.silent(Q_EXPLORE, { f: first }, state.T1),
    { small: 5, large: 20 },
  );

  // Phép kiểm THẬT SỰ của bản memo. Δ=0 ở trên KHÔNG chứng minh được memo:
  // `exploreFeed` một mình chỉ chạm `blockedUserIds` đúng một lần, nên không có
  // memo nó vẫn ra 1 query. Chỉ khi CẢ BA call-site nằm trong CÙNG một request
  // thì "1 query cho cả request" mới khác được với "1 query cho mỗi call-site".
  // Không memo ⇒ 3. `pin` hỏi pin_13_id (của alice, không bị chặn) để cả ba
  // trường cùng trả về sạch, không lẫn lỗi vào phép đo.
  const COMBINED = `query($f:Int!,$u:ID!,$p:ID!){
    exploreFeed(first:$f){ items{ id } }
    userPins(userId:$u, first:$f){ items{ id } }
    pin(id:$p){ id }
  }`;
  await h.silent(COMBINED, { f: 5, u: USERS.alice.id, p: ALICE_PIN }, state.T1); // nạp cache/JIT
  const combined = await countBlockedUserQueries(h, () =>
    h.silent(COMBINED, { f: 5, u: USERS.alice.id, p: ALICE_PIN }, state.T1),
  );
  if (combined.n === null) {
    h.rec('memo: 1 query BlockedUser cho CẢ request (3 call-site)', 'SKIP', 'không có VERIFY_LOG ⇒ không đo được');
  } else if (combined.n === 0 && !combined.result?.errors) {
    // 0 là BẤT KHẢ THI khi query trả về dữ liệu: cả ba call-site đều gọi
    // `getBlockedUserIds`. Đọc ra 0 ⇒ cửa sổ đo không hứng được log (VERIFY_LOG
    // trỏ sai file / API đang chạy là tiến trình khác). Ghi SKIP chứ KHÔNG ghi
    // FAIL: báo bug vào đường code memo là báo nhầm chỗ, và đó chính là cái
    // FAIL "trôi" đã tốn hai đợt để truy (xem debug_history §30).
    h.rec(
      'memo: 1 query BlockedUser cho CẢ request (3 call-site chung một document)',
      'SKIP',
      'đọc ra 0 query BlockedUser — bất khả thi khi query trả dữ liệu ⇒ log không hứng được. ' +
        'Kiểm VERIFY_LOG có đúng file API đang ghi, và API :4000 có phải tiến trình đó không',
    );
  } else {
    h.assert(
      'memo: 1 query BlockedUser cho CẢ request (3 call-site chung một document)',
      combined.n === 1 && !combined.result?.errors,
      `${combined.n} query BlockedUser cho 3 call-site (không memo ⇒ 3)` +
        (combined.result?.errors ? ` · LỖI: ${combined.result.errors[0].message}` : ''),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEW-1 (18/08/2026) — BỐN NHÓM BỀ MẶT MỚI: bình luận · board · tin nhắn ·
  // thông báo.
  //
  // Vì sao chúng nằm ở đây chứ không thành bước riêng: cửa sổ "đang block" chỉ
  // tồn tại giữa `blockUser` ở trên và `unblockUser` ở dưới. Tách ra bước khác
  // là phải block/unblock lần nữa, mà `blockUser` XOÁ FOLLOW VĨNH VIỄN (xem đầu
  // file) ⇒ mỗi lần lặp là một lần nữa phải dựng lại cạnh, tăng bề mặt hỏng.
  //
  // ⚠️ Toàn bộ dữ liệu setup dưới đây được dọn ở cuối bước. Bỏ dọn thì lần chạy
  // sau đếm lệch — đúng bài học cốt lõi của file này.
  // ═══════════════════════════════════════════════════════════════════════════
  {
    h.setGroup('GQL/blocking');

    // Marker duy nhất để tìm lại đúng bản ghi mình tạo, không đụng dữ liệu seed.
    const MARK = `r1probe`;
    const johnCommentContent = `${MARK} comment cua john`;
    const johnReplyContent = `${MARK} reply cua john`;
    const johnBoardName = `${MARK} board cua john`;

    const created = { comment: null, reply: null, board: null };

    // ─── Setup: john tạo bình luận + trả lời + board (TRONG lúc đang block) ──
    // Tạo được kể cả khi đang bị chặn — chặn là luật ĐỌC ở phía bao, không phải
    // luật ghi ở phía john. Nếu sau này backend cấm ghi thì phép setup này sẽ
    // đỏ ngay tại đây và nói đúng lý do.
    {
      const c = await h.silent(
        `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
        { i: { pinId: BAO_PINS[0], content: johnCommentContent } },
        state.T3,
      );
      created.comment = c?.data?.createComment?.id ?? null;

      if (created.comment) {
        const r = await h.silent(
          `mutation($i:CreateCommentInput!){ createComment(input:$i){ id } }`,
          { i: { pinId: BAO_PINS[0], content: johnReplyContent, parentId: created.comment } },
          state.T3,
        );
        created.reply = r?.data?.createComment?.id ?? null;
      }

      const b = await h.silent(
        `mutation($i:CreateBoardInput!){ createBoard(input:$i){ id } }`,
        { i: { name: johnBoardName } },
        state.T3,
      );
      created.board = b?.data?.createBoard?.id ?? null;
    }

    h.assert(
      'REVIEW-1 tiền đề: dựng được bình luận + trả lời + board của john để CÓ THỨ MÀ MẤT',
      !!created.comment && !!created.reply && !!created.board,
      `comment=${created.comment ?? 'KHÔNG TẠO ĐƯỢC'} · reply=${created.reply ?? 'KHÔNG TẠO ĐƯỢC'} · board=${created.board ?? 'KHÔNG TẠO ĐƯỢC'}`,
    );

    // ─── Bề mặt 1: pinComments ───────────────────────────────────────────────
    const Q_COMMENTS = `query($p:String!){ pinComments(pinId:$p, first:50){ items{ id content } } }`;
    const Q_REPLIES = `query($c:String!){ commentReplies(commentId:$c, first:50){ items{ id content } } }`;

    const cByBao = await h.silent(Q_COMMENTS, { p: BAO_PINS[0] }, state.T1);
    const cIdsBao = (cByBao?.data?.pinComments?.items ?? []).map((x) => x.id);
    h.assert(
      'REVIEW-1 pinComments: bao KHÔNG thấy bình luận của john, VẪN thấy bình luận khác',
      !cByBao?.errors && !cIdsBao.includes(created.comment) && cIdsBao.length > 0,
      cByBao?.errors
        ? `LỖI: ${cByBao.errors[0].message}`
        : `${cIdsBao.length} bình luận, bình luận của john ${cIdsBao.includes(created.comment) ? 'CÒN SÓT' : 'đã ẩn'}`,
    );

    // Đối chứng cùng cửa sổ: chính john vẫn đọc được bình luận của mình.
    const cByJohn = await h.silent(Q_COMMENTS, { p: BAO_PINS[0] }, state.T3);
    const cIdsJohn = (cByJohn?.data?.pinComments?.items ?? []).map((x) => x.id);
    h.assert(
      'REVIEW-1 pinComments ĐỐI CHỨNG: john vẫn đọc được bình luận của chính mình (không lọc quá tay)',
      !cByJohn?.errors && cIdsJohn.includes(created.comment),
      cByJohn?.errors ? `LỖI: ${cByJohn.errors[0].message}` : `john thấy ${cIdsJohn.length} bình luận, có bình luận của mình`,
    );

    const rByBao = await h.silent(Q_REPLIES, { c: created.comment }, state.T1);
    h.assert(
      'REVIEW-1 commentReplies: trả lời của john cũng bị ẩn với bao',
      !rByBao?.errors && !(rByBao?.data?.commentReplies?.items ?? []).some((x) => x.id === created.reply),
      rByBao?.errors
        ? `LỖI: ${rByBao.errors[0].message}`
        : `${(rByBao?.data?.commentReplies?.items ?? []).length} trả lời, trả lời của john đã ẩn`,
    );

    // ─── Bề mặt 2: boards ────────────────────────────────────────────────────
    const bByBao = await h.silent(
      `query($u:ID!){ userBoards(userId:$u, first:50){ items{ id name } } }`,
      { u: USERS.john.id },
      state.T1,
    );
    h.assert(
      'REVIEW-1 userBoards(john) theo bao: trang RỖNG, KHÔNG ném lỗi (khớp hình dạng userPins)',
      !bByBao?.errors && (bByBao?.data?.userBoards?.items ?? []).length === 0,
      bByBao?.errors
        ? `NÉM LỖI (phải trả rỗng): ${bByBao.errors[0].message}`
        : `${(bByBao?.data?.userBoards?.items ?? []).length} board (phải 0)`,
    );

    const boardDirect = await h.silent(`query($id:ID!){ board(id:$id){ id name } }`, { id: created.board }, state.T1);
    h.assert(
      'REVIEW-1 board(id) theo bao → NotFound (không lách được bằng link board trực tiếp)',
      /not found/i.test(boardDirect?.errors?.[0]?.message ?? '') && !boardDirect?.data?.board,
      boardDirect?.errors?.[0]?.message
        ? `ném đúng: ${boardDirect.errors[0].message}`
        : `KHÔNG ném lỗi — vẫn đọc được board qua link trực tiếp: ${JSON.stringify(boardDirect?.data?.board)}`,
    );

    // ─── Bề mặt 3: savedPins (query MỚI của REVIEW-1) ────────────────────────
    const savedOfJohn = await h.silent(
      `query($u:ID!){ savedPins(userId:$u, first:50){ items{ id } } }`,
      { u: USERS.john.id },
      state.T1,
    );
    h.assert(
      'REVIEW-1 savedPins(john) theo bao: trang RỖNG, KHÔNG ném lỗi',
      !savedOfJohn?.errors && (savedOfJohn?.data?.savedPins?.items ?? []).length === 0,
      savedOfJohn?.errors
        ? `NÉM LỖI (phải trả rỗng): ${savedOfJohn.errors[0].message}`
        : `${(savedOfJohn?.data?.savedPins?.items ?? []).length} dòng (phải 0)`,
    );

    // ─── Bề mặt 4: tin nhắn — CẤM GỬI, GIỮ LỊCH SỬ ───────────────────────────
    // Hình dạng này do người dùng chốt (18/08): giống Messenger. Nên ở đây phải
    // khẳng định CẢ HAI vế; chỉ kiểm vế cấm gửi thì một bản cài đặt ẩn luôn hội
    // thoại vẫn xanh, mà đó là hành vi khác hẳn.
    const convs = await h.silent(
      `query{ conversations(first:50){ items{ id members{ user{ id } } } } }`,
      {},
      state.T1,
    );
    const convWithJohn = (convs?.data?.conversations?.items ?? []).find((c) =>
      (c.members ?? []).some((m) => m.user?.id === USERS.john.id),
    );

    h.assert(
      'REVIEW-1 tin nhắn: hội thoại với john VẪN nằm trong hộp thư sau khi chặn (giữ lịch sử)',
      !convs?.errors && !!convWithJohn,
      convs?.errors ? `LỖI: ${convs.errors[0].message}` : convWithJohn ? `còn hội thoại ${convWithJohn.id}` : 'MẤT hội thoại (phải giữ)',
    );

    if (convWithJohn) {
      const readHistory = await h.silent(
        // `messages` khai `conversationId: String!` (KHÔNG phải ID!) — khai sai
        // kiểu biến là query bị từ chối ở tầng validation, trông y hệt "không
        // đọc được lịch sử".
        `query($c:String!){ messages(conversationId:$c, first:5){ items{ id } } }`,
        { c: convWithJohn.id },
        state.T1,
      );
      h.assert(
        'REVIEW-1 tin nhắn: ĐỌC lại lịch sử với john vẫn được',
        !readHistory?.errors && (readHistory?.data?.messages?.items ?? []).length > 0,
        readHistory?.errors
          ? `LỖI: ${readHistory.errors[0].message}`
          : `đọc được ${(readHistory?.data?.messages?.items ?? []).length} tin`,
      );

      const blockedSend = await h.silent(
        `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id } }`,
        { i: { conversationId: convWithJohn.id, content: `${MARK} khong duoc gui` } },
        state.T1,
      );
      h.assert(
        'REVIEW-1 tin nhắn: GỬI tin mới cho john bị chặn (Forbidden)',
        /blocked/i.test(blockedSend?.errors?.[0]?.message ?? '') && !blockedSend?.data?.sendMessage,
        blockedSend?.errors?.[0]?.message
          ? `ném đúng: ${blockedSend.errors[0].message}`
          : `KHÔNG chặn — vẫn gửi được tin cho người đã chặn: ${JSON.stringify(blockedSend?.data?.sendMessage)}`,
      );
    }

    // ─── Bề mặt 5: thông báo ─────────────────────────────────────────────────
    // Seed có sẵn thông báo FOLLOW từ john tới bao ⇒ đo được cả hai chiều mà
    // không phải dựng thêm. `actor` là nơi lọc (`actorId`), không phải recipient.
    const notifBlocked = await h.silent(
      `query{ notifications(first:50){ items{ id actor{ id } } } }`,
      {},
      state.T1,
    );
    const fromJohnBlocked = (notifBlocked?.data?.notifications?.items ?? []).filter(
      (n) => n.actor?.id === USERS.john.id,
    ).length;
    h.assert(
      'REVIEW-1 notifications: 0 thông báo có actor là john trong lúc chặn',
      !notifBlocked?.errors && fromJohnBlocked === 0,
      notifBlocked?.errors ? `LỖI: ${notifBlocked.errors[0].message}` : `${fromJohnBlocked} thông báo của john (phải 0)`,
    );

    const unreadBlocked = await h.silent(`query{ unreadNotificationCount }`, {}, state.T1);
    h.assert(
      'REVIEW-1 unreadNotificationCount: đọc được và KHÔNG ném lỗi khi đang lọc',
      !unreadBlocked?.errors && typeof unreadBlocked?.data?.unreadNotificationCount === 'number',
      unreadBlocked?.errors
        ? `LỖI: ${unreadBlocked.errors[0].message}`
        : `count=${unreadBlocked?.data?.unreadNotificationCount}`,
    );

    // Ghi lại để đối chứng SAU unblock (đặt lên `state` vì khối này đóng lại
    // trước khi unblock chạy).
    state.__review1 = { created, fromJohnBlocked, commentContent: johnCommentContent };
  }

  // ─── Unblock ⇒ mọi thứ trở lại ────────────────────────────────────────────
  h.setGroup('GQL/mut');
  await gql('unblockUser (bao → john)', `mutation($u:String!){ unblockUser(userId:$u) }`, { u: USERS.john.id }, { token: state.T1 });

  h.setGroup('GQL/blocking');
  const feedRestored = await feed(state.T1);
  const johnRestored = await pinsOf(USERS.john.id, state.T1);
  const pinRestored = await h.silent(Q_PIN, { id: SUNSET_PIN }, state.T1);

  h.assert(
    'sau unblock: cả 3 đường trở lại như trước (feed · userPins · pin)',
    JOHN_PINS.every((p) => feedRestored.ids.includes(p)) &&
      johnRestored.ids.length === 4 &&
      !pinRestored?.errors &&
      pinRestored?.data?.pin?.id === SUNSET_PIN,
    `feed=${feedRestored.ids.length} pin (đủ 4 của john) · userPins(john)=${johnRestored.ids.length} · pin(${SUNSET_PIN})=${pinRestored?.errors ? pinRestored.errors[0].message : 'trả về dữ liệu'}`,
  );

  // ─── REVIEW-1: đối chứng CHIỀU NGƯỢC + dọn dữ liệu setup ──────────────────
  //
  // Chiều ngược quan trọng ngang chiều thuận: một bản cài đặt xoá thẳng dữ liệu
  // (thay vì lọc lúc đọc) sẽ xanh trọn vẹn ở mọi phép trên rồi đỏ đúng ở đây.
  {
    const r1 = state.__review1;
    if (r1) {
      const cBack = await h.silent(
        `query($p:String!){ pinComments(pinId:$p, first:50){ items{ id } } }`,
        { p: BAO_PINS[0] },
        state.T1,
      );
      const notifBack = await h.silent(`query{ notifications(first:50){ items{ actor{ id } } } }`, {}, state.T1);
      const fromJohnBack = (notifBack?.data?.notifications?.items ?? []).filter(
        (n) => n.actor?.id === USERS.john.id,
      ).length;

      h.assert(
        'REVIEW-1 sau unblock: bình luận của john và thông báo của john hiện lại (lọc lúc ĐỌC, không xoá dữ liệu)',
        !cBack?.errors &&
          (cBack?.data?.pinComments?.items ?? []).some((x) => x.id === r1.created.comment) &&
          fromJohnBack > 0,
        `bình luận của john: ${(cBack?.data?.pinComments?.items ?? []).some((x) => x.id === r1.created.comment) ? 'hiện lại' : 'VẪN MẤT'} · ` +
          `thông báo của john: ${r1.fromJohnBlocked} (đang chặn) → ${fromJohnBack} (đã bỏ chặn)`,
      );

      // Dọn — thứ tự: reply trước comment gốc (an toàn với mọi ràng buộc), rồi
      // board. Dùng token của john vì chỉ chủ sở hữu mới xoá được.
      if (r1.created.reply) {
        await h.silent(`mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: r1.created.reply }, state.T3);
      }
      if (r1.created.comment) {
        await h.silent(`mutation($id:String!){ deleteComment(id:$id){ id } }`, { id: r1.created.comment }, state.T3);
      }
      if (r1.created.board) {
        await h.silent(`mutation($id:String!){ deleteBoard(id:$id) }`, { id: r1.created.board }, state.T3);
      }

      const leftover = await h.silent(
        `query($p:String!){ pinComments(pinId:$p, first:50){ items{ id content } } }`,
        { p: BAO_PINS[0] },
        state.T1,
      );
      const stillMarked = (leftover?.data?.pinComments?.items ?? []).filter((x) =>
        (x.content ?? '').includes('r1probe'),
      ).length;
      h.assert(
        'REVIEW-1 teardown: đã dọn sạch dữ liệu setup (lần chạy sau không đếm lệch)',
        stillMarked === 0,
        stillMarked === 0 ? 'không còn bản ghi mang marker r1probe' : `CÒN ${stillMarked} bản ghi r1probe — lần chạy sau sẽ lệch`,
      );

      delete state.__review1;
    }
  }

  // ─── Dọn: dựng lại quan hệ follow mà blockUser đã xoá vĩnh viễn ────────────
  // Đây KHÔNG phải phép kiểm trang trí: seed có bao↔john mutual và bước 20 của
  // lần chạy KẾ TIẾP đối chiếu `followers(bao)` có john trong đó. `follow()` cố
  // ý từ chối trùng nên dùng silent() cho phần gọi.
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: USERS.john.id }, state.T1);
  await h.silent(`mutation($u:String!){ follow(userId:$u) }`, { u: USERS.bao.id }, state.T3);

  const back = await h.silent(
    `query($u:String!){ userByUsername(username:$u){ id isFollowedByViewer isFollowingViewer } }`,
    { u: USERS.john.username },
    state.T1,
  );
  const rel = back?.data?.userByUsername;
  h.assert(
    'đã dựng lại mutual follow bao↔john mà blockUser xoá (tiền đề của lần chạy sau)',
    rel?.isFollowedByViewer === true && rel?.isFollowingViewer === true,
    rel ? `bao→john=${rel.isFollowedByViewer} · john→bao=${rel.isFollowingViewer}` : 'không đọc được quan hệ',
  );

  // Bước sau (70-subscriptions) phụ thuộc cạnh follow, nên chỉ đi tiếp khi đã
  // khôi phục xong.
  return rel?.isFollowedByViewer === true && rel?.isFollowingViewer === true;
}
