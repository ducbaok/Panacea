// Bước 70 — Subscriptions qua WebSocket client THẬT (13 phép kiểm tra)
//
// VÌ SAO PHẢI LÀ WS CLIENT THẬT: GraphQL Playground KHÔNG gửi header qua
// WebSocket, nên "thử trên Playground thấy chạy" không chứng minh được gì.
// Token phải đi trong `connectionParams` của `connection_init`.
// Xem LEARNING_NOTES.md §13.G.
//
// Hai subscription này từng CHẾT HOÀN TOÀN mà build vẫn sạch: `GqlThrottlerGuard`
// đăng ký làm APP_GUARD nên chạy cho cả nhánh WebSocket, và
// `ThrottlerGuard.handleRequest()` luôn gọi `res.header(...)` — nhánh WS không
// có `res`. Guard đó chạy TRƯỚC `GqlAuthGuard` nên chặn sạch mọi `subscribe`.
// Đó là lý do bước này tồn tại: 3 lớp trước nó đều xanh mà tính năng vẫn chết.

import { WS, sleep } from '../lib/client.mjs';

/**
 * Mở WS và làm xong handshake `graphql-transport-ws`.
 * Resolve khi nhận `connection_ack`; reject nếu socket đóng trước đó.
 */
function connect(connectionParams, { timeout = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(WS, 'graphql-transport-ws');
    const events = [];
    let acked = false;
    const timer = setTimeout(() => reject(new Error('timeout chờ connection_ack')), timeout);

    sock.addEventListener('open', () => {
      sock.send(JSON.stringify({ type: 'connection_init', payload: connectionParams ?? {} }));
    });
    sock.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'connection_ack') {
        acked = true;
        clearTimeout(timer);
        resolve({ sock, events });
        return;
      }
      events.push(msg);
    });
    sock.addEventListener('close', (ev) => {
      clearTimeout(timer);
      if (!acked) {
        reject(Object.assign(new Error(`socket đóng: ${ev.code} ${ev.reason}`), { code: ev.code, reason: ev.reason }));
      }
    });
    sock.addEventListener('error', () => {
      /* 'close' sẽ xử lý */
    });
  });
}

const subscribe = (sock, id, query, variables) =>
  sock.send(JSON.stringify({ id, type: 'subscribe', payload: { query, variables } }));

/**
 * Rò rỉ = frame `next` MANG DỮ LIỆU thật cho field đó.
 * Một `next` chỉ chứa `errors` (ví dụ 403 lúc subscribe) KHÔNG phải rò rỉ —
 * đó chính là hành vi fail-closed mong muốn.
 */
const isLeak = (id, field) => (m) => m.type === 'next' && m.id === id && m.payload?.data?.[field] != null;

/** Chờ tới khi `events` có message thoả `pred`, hoặc hết thời gian. */
async function waitFor(events, pred, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = events.find(pred);
    if (hit) return hit;
    await sleep(100);
  }
  return null;
}

export default async function (h) {
  const { state, silent } = h;
  const { T1, T2, T3, ME, ME2 } = state;

  h.setGroup('GQL/subscription');

  // Hội thoại nền. Mutual follow đã do bước 20 dựng; `createConversation` trả
  // lại hội thoại đang có nếu đã tồn tại (bước 50 tạo rồi).
  const conv = await silent(`mutation($u:String!){ createConversation(userId:$u){ id } }`, { u: ME2 }, T1);
  const CONV = conv?.data?.createConversation?.id;
  if (!CONV) {
    h.rec('dựng được conversation nền cho subscription', 'FAIL', JSON.stringify(conv?.errors ?? conv).slice(0, 200));
    return true; // vẫn cho bước 90 chạy để dọn tài khoản probe
  }

  // ═══════════ 1. Xác thực ở handshake ═══════════
  for (const [label, params] of [
    ['không gửi token → socket phải bị đóng', {}],
    ['token rác → socket phải bị đóng', { Authorization: 'Bearer not-a-real-token' }],
  ]) {
    try {
      const { sock } = await connect(params);
      h.rec(label, 'FAIL', 'socket vẫn được ack — cổng hậu, subscription không cần token!');
      sock.close();
    } catch (e) {
      if (e.message.includes('timeout')) h.rec(label, 'FAIL', 'không ack mà cũng không đóng — treo');
      else h.rec(label, 'OK', `đóng đúng (code ${e.code})`);
    }
  }
  try {
    const { sock } = await connect({ Authorization: `Bearer ${T2}` });
    h.rec('token hợp lệ → connection_ack', 'OK');
    sock.close();
  } catch (e) {
    h.rec('token hợp lệ → connection_ack', 'FAIL', e.message);
  }

  // ═══════════ 2. notificationReceived ═══════════
  try {
    const { sock, events } = await connect({ Authorization: `Bearer ${T2}` });
    subscribe(sock, 'n1', `subscription{ notificationReceived{ id type recipientId actor{ username } } }`);
    await sleep(1200); // để server kịp đăng ký subscription trước khi bắn event

    // sinh event thật: bao unfollow rồi follow lại alice
    await silent(`mutation($u:String!){ unfollow(userId:$u) }`, { u: ME2 }, T1);
    await sleep(300);
    await silent(`mutation($u:String!){ follow(userId:$u) }`, { u: ME2 }, T1);

    const got = await waitFor(events, (m) => m.type === 'next' && m.id === 'n1');
    const err = events.find((m) => m.type === 'error');
    if (got) {
      const n = got.payload.data.notificationReceived;
      h.rec('nhận được notification qua WS', 'OK', `type=${n.type} actor=${n.actor?.username}`);
      h.rec(
        'notification gửi đúng người nhận (filter)',
        n.recipientId === ME2 ? 'OK' : 'FAIL',
        `recipientId=${n.recipientId} (alice=${ME2})`,
      );
    } else {
      h.rec(
        'nhận được notification qua WS',
        'FAIL',
        err ? `server trả error: ${JSON.stringify(err.payload)}` : 'hết thời gian, không có message nào',
      );
    }
    sock.close();
  } catch (e) {
    h.rec('nhận được notification qua WS', 'FAIL', e.message);
  }

  // ═══════════ 3. notification KHÔNG rò sang người khác ═══════════
  try {
    const { sock, events } = await connect({ Authorization: `Bearer ${T3}` }); // john
    subscribe(sock, 'n2', `subscription{ notificationReceived{ id type recipientId } }`);
    await sleep(1200);
    await silent(`mutation($u:String!){ unfollow(userId:$u) }`, { u: ME2 }, T1);
    await sleep(300);
    await silent(`mutation($u:String!){ follow(userId:$u) }`, { u: ME2 }, T1); // notification dành cho alice

    const leaked = await waitFor(events, isLeak('n2', 'notificationReceived'), 3500);
    h.rec(
      'john KHÔNG nhận notification của alice',
      leaked ? 'FAIL' : 'OK',
      leaked ? `RÒ RỈ: ${JSON.stringify(leaked.payload.data)}` : 'không nhận gì (đúng)',
    );
    sock.close();
  } catch (e) {
    h.rec('john KHÔNG nhận notification của alice', 'FAIL', e.message);
  }

  // ═══════════ 4. messageReceived ═══════════
  let MSG_ID = null;
  try {
    const { sock, events } = await connect({ Authorization: `Bearer ${T2}` }); // alice, là thành viên
    subscribe(sock, 'm1', `subscription($c:String!){ messageReceived(conversationId:$c){ id content senderId } }`, { c: CONV });
    await sleep(1200);

    const sent = await silent(
      `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id content } }`,
      { i: { conversationId: CONV, content: `ws probe ${Date.now()}` } },
      T1,
    );
    MSG_ID = sent?.data?.sendMessage?.id;

    const got = await waitFor(events, (m) => m.type === 'next' && m.id === 'm1');
    const err = events.find((m) => m.type === 'error');
    if (got) {
      const msg = got.payload.data.messageReceived;
      h.rec('nhận được message qua WS', 'OK', `content="${msg.content}" sender=${msg.senderId}`);
      h.rec('message đúng cái vừa gửi', msg.id === MSG_ID ? 'OK' : 'FAIL', `id nhận=${msg.id} id gửi=${MSG_ID}`);
    } else {
      h.rec(
        'nhận được message qua WS',
        'FAIL',
        err ? `server trả error: ${JSON.stringify(err.payload)}` : 'hết thời gian, không có message nào',
      );
    }
    sock.close();
  } catch (e) {
    h.rec('nhận được message qua WS', 'FAIL', e.message);
  }

  // ═══════════ 5. người ngoài hội thoại phải bị chặn ═══════════
  try {
    const { sock, events } = await connect({ Authorization: `Bearer ${T3}` }); // john, KHÔNG phải thành viên
    subscribe(sock, 'm2', `subscription($c:String!){ messageReceived(conversationId:$c){ id content } }`, { c: CONV });
    await sleep(1200);
    await silent(
      `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id } }`,
      { i: { conversationId: CONV, content: `secret ${Date.now()}` } },
      T1,
    );

    const leaked = await waitFor(events, isLeak('m2', 'messageReceived'), 3500);
    const rejected = events.find((m) => m.id === 'm2' && (m.type === 'error' || m.type === 'complete' || m.payload?.errors));
    if (leaked) {
      h.rec('john bị chặn khỏi hội thoại của bao↔alice', 'FAIL', `RÒ RỈ DM: ${JSON.stringify(leaked.payload.data)}`);
    } else if (rejected) {
      h.rec(
        'john bị chặn khỏi hội thoại của bao↔alice',
        'OK',
        `server từ chối lúc subscribe: ${rejected.type} ${JSON.stringify(rejected.payload ?? '')}`.slice(0, 160),
      );
    } else {
      h.rec('john bị chặn khỏi hội thoại của bao↔alice', 'OK', 'không nhận được gì (filter fail-closed)');
    }
    sock.close();
  } catch (e) {
    h.rec('john bị chặn khỏi hội thoại của bao↔alice', 'FAIL', e.message);
  }

  // ═══════════ 6. DateTime đi qua PubSub (bug 17/08, FE-8 phát hiện) ═══════════
  //
  // VÌ SAO PHẢI CÓ MỤC RIÊNG: 5 mục trên đều CỐ Ý không chọn field ngày nào,
  // nên chúng xanh suốt trong khi mọi client thật chọn `createdAt` đều nhận
  // `data: null`. Payload qua Redis bị `JSON.stringify` ⇒ `Date` thành chuỗi
  // ISO ⇒ `DateTime.serialize()` trả `null` ⇒ field non-null nổ. Bản vá nằm ở
  // `apps/api/src/redis/pubsub-serde.ts`.
  //
  // Phép kiểm KHÔNG dừng ở "khác null": chuỗi ISO sai múi giờ / lệch mili-giây
  // vẫn khác null. Nó đối chiếu với **chính bản ghi đó đọc qua query HTTP** —
  // đường không đi qua PubSub — nên chỉ xanh khi giá trị bằng nhau tới mili-giây.
  try {
    const { sock, events } = await connect({ Authorization: `Bearer ${T2}` }); // alice
    subscribe(sock, 'n3', `subscription{ notificationReceived{ id type createdAt } }`);
    await sleep(1200);
    await silent(`mutation($u:String!){ unfollow(userId:$u) }`, { u: ME2 }, T1);
    await sleep(300);
    await silent(`mutation($u:String!){ follow(userId:$u) }`, { u: ME2 }, T1);

    const got = await waitFor(events, (m) => m.type === 'next' && m.id === 'n3');
    const n = got?.payload?.data?.notificationReceived;
    h.rec(
      'notificationReceived CHỌN createdAt → có data (không lỗi serialize)',
      n ? 'OK' : 'FAIL',
      n
        ? `createdAt=${n.createdAt}`
        : `payload=${JSON.stringify(got?.payload ?? events.find((m) => m.type === 'error')?.payload ?? 'không có frame nào').slice(0, 200)}`,
    );

    // đối chiếu với giá trị đọc qua HTTP cho ĐÚNG bản ghi đó
    const viaHttp = await silent(
      `query($f:Int!){ notifications(first:$f){ items{ id createdAt } } }`,
      { f: 10 },
      T2,
    );
    const row = viaHttp?.data?.notifications?.items?.find((i) => i.id === n?.id);
    h.assert(
      'createdAt qua WS === createdAt qua HTTP (cùng notification)',
      !!n && !!row && n.createdAt === row.createdAt,
      `ws=${n?.createdAt} http=${row?.createdAt}`,
    );
    sock.close();
  } catch (e) {
    h.rec('notificationReceived CHỌN createdAt → có data (không lỗi serialize)', 'FAIL', e.message);
  }

  let MSG_ID_DT = null;
  try {
    const { sock, events } = await connect({ Authorization: `Bearer ${T2}` }); // alice
    subscribe(
      sock,
      'm3',
      `subscription($c:String!){ messageReceived(conversationId:$c){ id content createdAt } }`,
      { c: CONV },
    );
    await sleep(1200);

    const sent = await silent(
      `mutation($i:SendMessageInput!){ sendMessage(input:$i){ id } }`,
      { i: { conversationId: CONV, content: `dt probe ${Date.now()}` } },
      T1,
    );
    MSG_ID_DT = sent?.data?.sendMessage?.id;

    const got = await waitFor(events, (m) => m.type === 'next' && m.id === 'm3');
    const msg = got?.payload?.data?.messageReceived;
    h.rec(
      'messageReceived CHỌN createdAt → có data (cùng bệnh, cùng bản vá)',
      msg ? 'OK' : 'FAIL',
      msg
        ? `createdAt=${msg.createdAt}`
        : `payload=${JSON.stringify(got?.payload ?? events.find((m) => m.type === 'error')?.payload ?? 'không có frame nào').slice(0, 200)}`,
    );

    const viaHttp = await silent(
      `query($c:String!,$f:Int!){ messages(conversationId:$c, first:$f){ items{ id createdAt } } }`,
      { c: CONV, f: 5 },
      T2,
    );
    const row = viaHttp?.data?.messages?.items?.find((i) => i.id === msg?.id);
    h.assert(
      'createdAt qua WS === createdAt qua HTTP (cùng message)',
      !!msg && !!row && msg.createdAt === row.createdAt,
      `ws=${msg?.createdAt} http=${row?.createdAt}`,
    );
    sock.close();
  } catch (e) {
    h.rec('messageReceived CHỌN createdAt → có data (cùng bệnh, cùng bản vá)', 'FAIL', e.message);
  }

  // dọn tin nhắn do bước này sinh ra
  if (MSG_ID) await silent(`mutation($m:String!){ deleteMessage(messageId:$m) }`, { m: MSG_ID }, T1);
  if (MSG_ID_DT) await silent(`mutation($m:String!){ deleteMessage(messageId:$m) }`, { m: MSG_ID_DT }, T1);

  // LUÔN trả true: subscription không phải tiền đề của bước 90, mà bước 90 mới
  // là chỗ xoá tài khoản probe. Dừng ở đây sẽ để rác lại cho lần chạy sau.
  return true;
}
