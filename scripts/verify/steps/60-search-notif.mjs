// Bước 60 — Search + Notifications
//
// Chạy SAU bước 20/40 là có chủ đích: `follow` và `toggleCommentReaction` ở các
// bước trước chính là thứ sinh ra notification thật để `markNotificationRead`
// có cái mà đánh dấu. Không có event nào ⇒ không có bản ghi ⇒ phép kiểm tra
// mất ý nghĩa (và bản gốc ghi thẳng FAIL trong trường hợp đó, giữ nguyên).

import { spawnSync } from 'node:child_process';

/**
 * psql runner cho đối chứng âm coalesce (B-3) — CHỈ dùng để tạo/xoá pin tạm
 * `description=NULL` mà seed không có sẵn. Yêu cầu docker + container
 * `antigravity-postgres` đang chạy (§9 brief B-3, đường vào chuẩn).
 */
function psql(sql) {
  const r = spawnSync(
    'docker',
    ['exec', 'antigravity-postgres', 'psql', '-U', 'antigravity', '-d', 'antigravity_dev', '-c', sql],
    { encoding: 'utf8' },
  );
  return { ok: r.status === 0, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

export default async function (h) {
  const { gql, state } = h;

  h.setGroup('GQL/query');

  // search dùng chung một câu truy vấn cho cả 3 nhánh: SDL trả về cả 3 khối
  // pins/users/boards, chỉ khối khớp `type` mới có dữ liệu.
  for (const t of ['PIN', 'USER', 'BOARD']) {
    await gql(
      `search(${t})`,
      `query($q:String!,$t:SearchType!,$f:Int!){ search(query:$q, type:$t, first:$f){ pins{ items{ id title } pageInfo{ endCursor } } users{ items{ id username } pageInfo{ endCursor } } boards{ items{ id name } pageInfo{ endCursor } } } }`,
      { q: 'design', t, f: 5 },
      { token: state.T1 },
    );
  }

  // ── B-3: searchPins đã chuyển sang tsvector full-text search ──────────────
  //
  // Ba `gql(search(...))` ở trên chỉ khẳng định "query CHẠY được", không giá
  // trị nào — chúng xanh vĩnh viễn kể cả khi search trả 0 kết quả (chính là
  // cái lỗ hổng đã dính ở Bug D+E và §4 của brief). Nhóm mới `GQL/search-fts`
  // là bằng chứng CÓ GIÁ TRỊ cho lô này.
  //
  // Bản ghi khẳng định HAI CHIỀU trong CÙNG một response (khuôn `GQL/viewer-
  // aware` của Đợt 3a) — đây là điều duy nhất bằng chứng ILIKE→FTS đã đi
  // đúng đường mà không chỉ đơn thuần "vẫn trả pin nào đó":
  //
  //   Trước (ILIKE `%design%`) — 3 pin: pin_7 · pin_6 · pin_5
  //   Sau  (tsvector 'design') — 2 pin: pin_7 · pin_5 (pin_6 rớt)
  //
  // Vì sao pin_6 "Pinterest UI Case Study" (description "Redesigning...")
  // KHÔNG khớp qua FTS: `websearch_to_tsquery('english','design')` sinh
  // lexeme `design`; lúc index hoá, `Redesigning` được stemmer chuyển thành
  // lexeme `redesign` — hai lexeme khác nhau nên không match. Người dùng gõ
  // `desig` cũng KHÔNG còn khớp — đó là bản chất của FTS, không phải bug,
  // nhưng phải viết ra rõ ràng vì UX đã đổi.
  //
  // Vì sao pin_5 "Pastel Color Palette" VẪN khớp: description có "UI
  // designs" → stemmer chuyển `designs` về lexeme `design` — trùng với
  // query lexeme.
  //
  // ⚠️ ĐỐI CHỨNG NGƯỢC — nếu ai đó bỏ `coalesce(...)` ở BIỂU THỨC FTS
  // (search.service.ts:~88), `title || ' ' || description` với `NULL ||
  // 'x' = NULL` sẽ nuốt mọi pin thiếu 1 trong 2 trường mà KHÔNG ném lỗi
  // nào. Seed hiện tại có đủ cả 2 trường nên đối chứng này KHÔNG bắt
  // được — tạo pin tạm `description=NULL` trong đối chứng thủ công (xem
  // debug_history §B-3) nếu cần.
  h.setGroup('GQL/search-fts');
  const Q_SEARCH_PIN = `query($q:String!){ search(query:$q, type:PIN, first:20){ pins{ items{ id title } } } }`;

  const rDesign = await h.silent(Q_SEARCH_PIN, { q: 'design' }, state.T1);
  const idsDesign = (rDesign?.data?.search?.pins?.items ?? []).map((i) => i.id);
  h.assert(
    'search("design") hai chiều CÙNG response: có pin_7 (khớp "Design" nguyên từ) · KHÔNG có pin_6 (chỉ khớp chuỗi con "design" trong "Redesigning")',
    !rDesign?.errors &&
      idsDesign.includes('pin_7_id') &&
      !idsDesign.includes('pin_6_id'),
    rDesign?.errors
      ? `LỖI: ${rDesign.errors[0].message}`
      : `pin_7: ${idsDesign.includes('pin_7_id') ? 'CÓ' : 'MẤT'} · pin_6: ${idsDesign.includes('pin_6_id') ? 'CÒN — ILIKE vẫn còn' : 'không có'} · items=${idsDesign.join(',') || 'rỗng'}`,
  );

  // Khách vãng lai — bắt regression `NOT IN ()` lúc `blockedIds = []` (mảng
  // rỗng là đường đi thường ngày của mọi request không token, không phải
  // biên hiếm). Bản mới dùng chung `_notInBlocked` với PinsService — helper
  // đó trả `null` khi rỗng — nên phép này KHÔNG đỏ-trước được ở đây, nó là
  // phép kiểm chéo cho tương lai.
  const rAnon = await h.silent(Q_SEARCH_PIN, { q: 'design' });
  const idsAnon = (rAnon?.data?.search?.pins?.items ?? []).map((i) => i.id);
  h.assert(
    'search("design") khách vãng lai: 200 · không lỗi cú pháp `NOT IN ()` · cùng tập với đăng nhập (chưa block ai)',
    !rAnon?.errors && idsAnon.length === idsDesign.length,
    rAnon?.errors
      ? `LỖI: ${rAnon.errors[0].message}`
      : `${idsAnon.length} pin (đăng nhập trả ${idsDesign.length}, bằng nhau)`,
  );

  // ── Đối chứng âm PERMANENT — pin `description=NULL` bảo vệ `coalesce` ────
  //
  // Vì sao TỒN TẠI: khi soạn B-3, thực nghiệm đã chứng minh — bỏ `coalesce`
  // khỏi cột description KHÔNG làm đỏ bất kỳ phép nào ở trên (verify vẫn
  // 194/0). Cả pin_7 (khớp chiều dương) lẫn pin_6 (chiều âm) đều có
  // description non-NULL nên không đo được. Seed cũng không có pin nào
  // description=NULL. Không có bản ghi này thì "bỏ coalesce ở description"
  // biến MỌI pin thiếu description khỏi search một cách vô hình — đúng
  // pattern §7.4 của brief cảnh báo.
  //
  // Cơ chế: `NULL || ' ' || 'x' = NULL` trong Postgres, `to_tsvector` trên
  // NULL trả NULL, `NULL @@ query` trả NULL ⇒ WHERE loại pin. Không lỗi,
  // không exception, chỉ "pin biến mất".
  //
  // Vì sao tạo qua psql chứ không createPin: (1) cần chốt id để cleanup;
  // (2) tạo qua createPin rồi deletePin thì bản ghi vẫn nằm trong DB
  // (deletedAt IS NOT NULL) — tích luỹ qua mỗi lần chạy.
  h.setGroup('GQL/search-fts');
  const CTRL_ID = 'ctrl_null_desc_xyzzynul';
  // Idempotent: nếu lần chạy trước bị ngắt giữa chừng, xoá trước cái sót.
  psql(`DELETE FROM "Pin" WHERE id = '${CTRL_ID}';`);
  const created = psql(
    `INSERT INTO "Pin" (id, title, description, "imageUrl", "creatorId", "createdAt", "updatedAt") ` +
      `VALUES ('${CTRL_ID}', 'Xyzzynul Coalesce Guard', NULL, 'https://example.com/x.jpg', 'user_1_id', NOW(), NOW());`,
  );
  if (!created.ok) {
    h.rec(
      'COALESCE GUARD: chuẩn bị pin tạm description=NULL',
      'FAIL',
      `psql INSERT thất bại: ${created.stderr.trim().slice(0, 200)}`,
    );
  } else {
    try {
      const rNul = await h.silent(Q_SEARCH_PIN, { q: 'xyzzynul' }, state.T1);
      const idsNul = (rNul?.data?.search?.pins?.items ?? []).map((i) => i.id);
      h.assert(
        'COALESCE GUARD: search("xyzzynul") khớp pin có description=NULL (bỏ coalesce khỏi 1 cột ⇒ NULL nuốt biểu thức, pin biến mất im lặng)',
        !rNul?.errors && idsNul.includes(CTRL_ID),
        rNul?.errors
          ? `LỖI: ${rNul.errors[0].message}`
          : idsNul.includes(CTRL_ID)
            ? 'khớp đúng — coalesce đang bảo vệ cả 2 cột'
            : `KHÔNG khớp — items=${idsNul.join(',') || 'rỗng'} · kiểm biểu thức FTS ở search.service.ts có còn coalesce ở CẢ title lẫn description không`,
      );
    } finally {
      psql(`DELETE FROM "Pin" WHERE id = '${CTRL_ID}';`);
    }
  }

  h.setGroup('GQL/query');
  await gql(
    'notifications',
    `query($f:Int!){ notifications(first:$f){ items{ id type isRead actor{ username } } pageInfo{ endCursor } } }`,
    { f: 5 },
    { token: state.T1 },
  );
  await gql('unreadNotificationCount', `{ unreadNotificationCount }`, {}, { token: state.T1 });

  const nt = await gql(
    'notifications (sau khi có event)',
    `query($f:Int!){ notifications(first:$f){ items{ id type isRead } } }`,
    { f: 5 },
    { token: state.T1 },
  );
  const NOTIF = nt?.notifications?.items?.[0]?.id;

  h.setGroup('GQL/mut');
  if (NOTIF) {
    await gql('markNotificationRead', `mutation($id:String!){ markNotificationRead(id:$id) }`, { id: NOTIF }, { token: state.T1 });
  } else {
    // Cố ý FAIL chứ không SKIP: không sinh được notification nào nghĩa là một
    // trong các bước trước đã không tạo ra event thật, đó là tin xấu.
    h.rec('markNotificationRead', 'FAIL', 'không sinh được notification nào để test');
  }
  await gql('markAllNotificationsRead', `mutation{ markAllNotificationsRead }`, {}, { token: state.T1 });

  return true;
}
