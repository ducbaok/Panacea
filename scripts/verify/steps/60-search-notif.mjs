// Bước 60 — Search + Notifications
//
// Chạy SAU bước 20/40 là có chủ đích: `follow` và `toggleCommentReaction` ở các
// bước trước chính là thứ sinh ra notification thật để `markNotificationRead`
// có cái mà đánh dấu. Không có event nào ⇒ không có bản ghi ⇒ phép kiểm tra
// mất ý nghĩa (và bản gốc ghi thẳng FAIL trong trường hợp đó, giữ nguyên).

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
