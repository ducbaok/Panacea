// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Client Redis tối giản cho bộ verify — nói RESP thẳng qua `node:net`      ║
// ║                                                                          ║
// ║  VÌ SAO KHÔNG DÙNG `docker exec … redis-cli` VÀ KHÔNG DÙNG `ioredis`:     ║
// ║    • `docker exec` buộc `pnpm verify` phụ thuộc Docker CLI **và** đúng    ║
// ║      cái tên container `antigravity-redis`. Đó là hai giả định về môi     ║
// ║      trường mà bộ này chưa từng cần, và cái tên container thì không phải  ║
// ║      thứ API nói tới bao giờ.                                            ║
// ║    • `ioredis` chỉ nằm trong `apps/api/node_modules`; kéo nó vào scripts  ║
// ║      ở gốc repo là thêm dependency cho một việc dài 60 dòng.              ║
// ║  Cách ở đây đọc `REDIS_URL` từ `apps/api/.env` — ĐÚNG chuỗi kết nối mà    ║
// ║  API đang dùng — nên nếu API nói chuyện với một Redis khác thì phép kiểm  ║
// ║  sẽ đỏ, chứ không âm thầm soi nhầm máy chủ.                               ║
// ║                                                                          ║
// ║  Không có `REDIS_URL` / không kết nối được ⇒ trả `null`, bên gọi PHẢI     ║
// ║  phát SKIP. "Không đo được" không phải "đo xong và đạt".                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import net from 'node:net';

/** Mã hoá một lệnh thành RESP array của bulk string. */
const encode = (args) =>
  Buffer.from(
    `*${args.length}\r\n` +
      args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join(''),
    'utf8',
  );

/**
 * Đọc MỘT reply RESP từ `buf` bắt đầu ở `i`.
 * @returns `{ value, next }` hoặc `null` nếu dữ liệu chưa về đủ.
 */
function parseReply(buf, i = 0) {
  if (i >= buf.length) return null;
  const crlf = buf.indexOf('\r\n', i);
  if (crlf === -1) return null;
  const head = buf.toString('utf8', i + 1, crlf);
  const after = crlf + 2;

  switch (String.fromCharCode(buf[i])) {
    case '+':
      return { value: head, next: after };
    case '-':
      return { value: new Error(head), next: after };
    case ':':
      return { value: Number(head), next: after };
    case '$': {
      const n = Number(head);
      if (n === -1) return { value: null, next: after };
      if (buf.length < after + n + 2) return null;
      return { value: buf.toString('utf8', after, after + n), next: after + n + 2 };
    }
    case '*': {
      const n = Number(head);
      if (n === -1) return { value: null, next: after };
      const out = [];
      let p = after;
      for (let k = 0; k < n; k++) {
        const r = parseReply(buf, p);
        if (!r) return null;
        out.push(r.value);
        p = r.next;
      }
      return { value: out, next: p };
    }
    default:
      return null;
  }
}

/**
 * Mở kết nối tới Redis.
 * @returns `{ cmd, close }` hoặc `null` nếu không kết nối được.
 *   `cmd('TTL', key)` trả thẳng giá trị RESP (số / chuỗi / mảng / `Error`).
 */
export async function connectRedis(url, timeoutMs = 4000) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    const sock = net.connect({ host: u.hostname, port: Number(u.port || 6379) });
    // Hạn CHỜ KẾT NỐI, không phải hạn nhàn rỗi. Bản đầu dùng
    // `sock.setTimeout(4000)` và để nguyên sau khi kết nối — sai nặng: giữa hai
    // lệnh Redis của bước 69 có 8 lần `bcrypt.compare` 12 vòng, tức hơn 4 giây
    // KHÔNG có byte nào trên socket. Socket bị `destroy`, các `cmd` sau đó ghi
    // vào ống đã chết và KHÔNG BAO GIỜ resolve ⇒ `run-all.mjs` chết câm với
    // **exit code 13** (Node: "Unsettled Top-Level Await"), không một dòng lỗi.
    sock.setTimeout(timeoutMs);

    let buf = Buffer.alloc(0);
    let dead = false;
    const waiting = [];

    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const r = parseReply(buf, 0);
        if (!r) break;
        buf = buf.subarray(r.next);
        waiting.shift()?.(r.value);
      }
    });

    // Socket chết giữa chừng: giải phóng mọi lệnh đang chờ bằng `Error` thay vì
    // treo vĩnh viễn — treo ở đây làm cả `pnpm verify` đứng im không lý do.
    const fail = (e) => {
      dead = true;
      while (waiting.length) waiting.shift()(e instanceof Error ? e : new Error(String(e)));
      done(null);
    };
    sock.on('error', fail);
    sock.on('timeout', () => {
      sock.destroy();
      fail(new Error('redis: hết hạn chờ kết nối'));
    });
    sock.on('close', () => fail(new Error('redis: socket đã đóng')));

    sock.on('connect', async () => {
      sock.setTimeout(0); // tắt hạn nhàn rỗi — xem ghi chú ở trên

      /**
       * Một lệnh. KHÔNG BAO GIỜ treo: socket chết ⇒ trả `Error` ngay, và mỗi
       * lệnh còn có hạn riêng làm lưới cuối. Trả `Error` chứ không `reject` để
       * bên gọi xử lý bằng SKIP/FAIL thay vì làm nổ cả bước.
       */
      const cmd = (...args) =>
        new Promise((res) => {
          if (dead) return res(new Error('redis: kết nối đã chết'));
          let settledCmd = false;
          const once = (v) => {
            if (!settledCmd) {
              settledCmd = true;
              clearTimeout(timer);
              res(v);
            }
          };
          const timer = setTimeout(() => once(new Error(`redis: lệnh ${args[0]} quá hạn`)), timeoutMs);
          timer.unref?.();
          waiting.push(once);
          sock.write(encode(args));
        });

      if (u.password) {
        const r = await cmd('AUTH', u.password);
        if (r instanceof Error) {
          sock.destroy();
          return done(null);
        }
      }
      const db = (u.pathname || '').replace(/^\//, '');
      if (db) await cmd('SELECT', db);

      done({
        cmd,
        close() {
          sock.removeAllListeners('close');
          sock.end();
        },
      });
    });
  });
}
