import {
  Injectable,
  Inject,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ExchangeDto } from './dto/exchange.dto';
import { GoogleAuthDto, RefreshTokenDto, ResetPasswordDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

/**
 * Hash giả dùng để so sánh khi user không tồn tại.
 * Mục đích: ngăn chặn timing attack — response time luôn giống nhau
 * bất kể email có trong DB hay không.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Tạo một hash hợp lệ bất kỳ bằng bcrypt: await bcrypt.hash('dummy', 12)
 * 2. Gán kết quả vào biến DUMMY_HASH (const).
 * 3. Sử dụng DUMMY_HASH trong login() khi user không tìm thấy.
 */
const DUMMY_HASH = '$2b$12$LJ3m4ys3Lgzwe5KPqdVGje6B/FJzHMSmh7fSsGiV0bNzT2eLFJKMy';

/**
 * Hạn chờ khi hỏi Google về một `idToken`. 5 giây: đủ rộng cho một round-trip
 * quốc tế bình thường, đủ hẹp để một endpoint treo không giữ luôn request của
 * người dùng. Hết hạn ⇒ 503 (tạm thời), KHÔNG phải 401 (token sai).
 */
const GOOGLE_TOKENINFO_TIMEOUT_MS = 5_000;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Ngưỡng + hai thời hạn của brute-force limiter, đọc MỘT LẦN lúc dựng service.
   * Đổi `LOGIN_*` trong `.env` ⇒ phải restart API mới có hiệu lực — đó là chủ
   * đích: đây là tham số an ninh, không phải cờ bật/tắt lúc chạy.
   */
  private readonly loginMaxAttempts: number;
  private readonly loginFailWindowSec: number;
  private readonly loginLockSec: number;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private readonly mailService: MailService,
    // Consumer ĐẦU TIÊN của `REDIS_CLIENT` ngoài factory `PUB_SUB`. `RedisModule`
    // là `@Global()` và đã được import ở `app.module.ts` ⇒ `auth.module.ts` KHÔNG
    // cần sửa gì.
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.loginMaxAttempts = this.configService.get<number>('auth.login.maxAttempts') ?? 5;
    this.loginFailWindowSec = this.configService.get<number>('auth.login.failWindowSec') ?? 900;
    this.loginLockSec = this.configService.get<number>('auth.login.lockSec') ?? 900;
  }

  // ─── Soft-delete helpers ────────────────────────────────────────────────────

  /**
   * ╔═════════════════════════════════════════════════════════════════════════╗
   * ║  TẠI SAO PHẢI CÓ HAI HÀM NÀY (P0 #4)                                    ║
   * ║                                                                          ║
   * ║  `deleteAccount()` chỉ set `deletedAt` (soft delete). Middleware trong   ║
   * ║  `prisma.service.ts` tự chèn `deletedAt: null` cho `findMany`/`findFirst`║
   * ║  — nhưng CỐ Ý KHÔNG chèn cho `findUnique`.                              ║
   * ║                                                                          ║
   * ║  Mọi đường đăng nhập (login/refresh/exchange/googleAuth) trước đây đều   ║
   * ║  dùng `findUnique` ⇒ tài khoản đã xóa VẪN lấy được access token.        ║
   * ║  Tệ hơn: token đó gọi `me` thì 404 (vì `usersService.findById` dùng      ║
   * ║  `findFirst`) → user rơi vào trạng thái "zombie": đăng nhập được nhưng   ║
   * ║  không tồn tại.                                                          ║
   * ╚═════════════════════════════════════════════════════════════════════════╝
   */

  /**
   * Tìm user CÒN HOẠT ĐỘNG theo email.
   * Ghi `deletedAt: null` tường minh dù middleware cũng chèn — để đọc code là
   * thấy ngay ý định, không phải nhớ tới middleware ở file khác.
   */
  private _findActiveUserByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  /**
   * Chặn các nhánh OAuth (exchange / googleAuth) tạo lại user cho một email đã
   * bị soft-delete.
   *
   * Nếu không có bước này: `_findActiveUserByEmail` trả null → code tưởng là
   * user mới → `user.create` → vỡ unique constraint `User_email_key` (P2002)
   * và client nhận lỗi 500 khó hiểu thay vì một thông báo đúng nghĩa.
   *
   * Dùng `findUnique` ở đây là CHỦ ĐÍCH — cần nhìn thấy cả bản ghi đã xóa.
   */
  private async _assertEmailNotSoftDeleted(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { deletedAt: true },
    });
    if (existing?.deletedAt) {
      throw new ForbiddenException('This account has been deleted');
    }
  }


  // ─── Register ───────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<TokenPair> {
    // TODO:
    // 1. Kiểm tra xem email đã tồn tại trong database chưa (ném ConflictException nếu có)
    // 2. Hash mật khẩu người dùng gửi lên bằng bcrypt (sử dụng hằng số BCRYPT_ROUNDS)
    // 3. Lưu user mới vào database (prisma.user.create). Dùng hàm _generateUsername để tự sinh username từ tên.
    // 4. (Tuỳ chọn) Có thể xử lý gửi email xác nhận ở bước này.
    // 5. Trả về TokenPair bằng cách gọi hàm _issueTokenPair.
    
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: passwordHash,
        name: dto.name,
        username: await this._generateUsername(dto.name),
      },
    });

    // Tạo verification token và gửi email
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 1000 * 60 * 60); // 1 giờ
    await this.prisma.verificationToken.create({
      data: {
        identifier: `verify:${dto.email}`,
        token: verifyToken,
        expires: verifyExpires,
        userId: user.id,
      },
    });
    await this.mailService.sendVerificationEmail(dto.email, verifyToken);

    return this._issueTokenPair(user.id, user.email);
  }

  // ─── Brute-force limiter (Redis) ────────────────────────────────────────────

  /**
   * ╔═════════════════════════════════════════════════════════════════════════╗
   * ║  VÌ SAO BỘ ĐẾM NÀY NẰM Ở REDIS CHỨ KHÔNG PHẢI `Map` (Đợt 7 · P1 #15)    ║
   * ║                                                                         ║
   * ║  Bản cũ là `private loginAttempts = new Map<string, {count, lockedUntil}>`║
   * ║  Nó có BA lỗi gốc, và cả ba đều được sửa bởi chính việc chuyển sang     ║
   * ║  Redis chứ không phải bởi một miếng vá riêng:                           ║
   * ║                                                                         ║
   * ║  (a) MAP KHÔNG CÓ TTL ⇒ ATTACKER ĐIỀU KHIỂN ĐƯỢC BỘ NHỚ SERVER.         ║
   * ║      `set()` chạy cho MỌI email, kể cả email KHÔNG TỒN TẠI (nhánh       ║
   * ║      `!user`), còn `delete()` chỉ chạy khi login THÀNH CÔNG. Email       ║
   * ║      không tồn tại thì không bao giờ có login thành công ⇒ entry nằm    ║
   * ║      lại VĨNH VIỄN. Gõ 1 triệu email rác = 1 triệu entry không bao giờ  ║
   * ║      được thu hồi. Ở đây `EXPIRE`/`SET … EX` của Redis lo việc đó: mọi  ║
   * ║      khoá đều có hạn, kể cả khoá của email không tồn tại.               ║
   * ║                                                                         ║
   * ║  (b) `count` KHÔNG SUY GIẢM ⇒ KHOÁ VĨNH VIỄN 15 PHÚT MỘT.               ║
   * ║      Bản cũ: `newCount = (attempt?.count || 0) + 1`. Sau lần khoá đầu   ║
   * ║      `count` đã ≥ MAX và KHÔNG BAO GIỜ được đặt lại về 0. Hết 15 phút   ║
   * ║      thì `lockedUntil` hết hạn, nhưng `count` vẫn ≥ MAX ⇒ cú gõ sai     ║
   * ║      KẾ TIẾP lập tức khoá thêm 15 phút nữa. Chỉ login ĐÚNG mới thoát,   ║
   * ║      mà người dùng quên mật khẩu thì không login đúng được — họ bị nhốt ║
   * ║      cho tới khi đổi mật khẩu. Ở đây `del(failKey)` NGAY LÚC KHOÁ làm   ║
   * ║      bộ đếm khởi động lại sạch, nên sau khi hết khoá người dùng lại có  ║
   * ║      đủ MAX lần thử.                                                    ║
   * ║                                                                         ║
   * ║  (c) `Map` LÀ STATE CỦA TIẾN TRÌNH ⇒ KHÔNG CHIA SẺ GIỮA INSTANCE.       ║
   * ║      3 pod = 15 lần thử thay vì 5, và một lần restart/deploy xoá sạch   ║
   * ║      mọi khoá đang có. Redis là nguồn sự thật DUY NHẤT cho cả cụm.      ║
   * ║                                                                         ║
   * ║  ⚠️ QUYẾT ĐỊNH AN NINH CÓ Ý THỨC — FAIL-**OPEN**.                       ║
   * ║  Mọi lệnh Redis dưới đây được bọc `try/catch`; Redis chết thì limiter   ║
   * ║  im lặng ngừng hoạt động và login VẪN ĐI TIẾP (chỉ log `warn`).         ║
   * ║  Đánh đổi: trong lúc Redis hỏng, brute-force không bị chặn.             ║
   * ║  Lý do vẫn chọn hướng này: fail-CLOSED biến một sự cố Redis thành       ║
   * ║  MẤT TOÀN BỘ KHẢ NĂNG ĐĂNG NHẬP của mọi người dùng — một sự cố hạ tầng  ║
   * ║  leo thang thành sự cố toàn sản phẩm. Cửa sổ hỏng của Redis ngắn và có  ║
   * ║  giám sát; mật khẩu vẫn được bcrypt bảo vệ và `ThrottlerModule` vẫn     ║
   * ║  chặn theo IP ở tầng trên (app.module.ts). Nếu sau này đổi sang         ║
   * ║  fail-closed thì phải đổi CÓ CHỦ ĐÍCH, kèm chế độ suy giảm.             ║
   * ╚═════════════════════════════════════════════════════════════════════════╝
   *
   * Băm email thay vì dùng thẳng làm khoá vì hai lẽ: (1) không đẩy PII vào
   * Redis — nơi dump/log dễ bị đọc hơn DB; (2) chặn attacker gửi email 10KB để
   * phình kích thước key. 32 ký tự hex = 128 bit, thừa sức chống đụng độ ở đây.
   *
   * ⚠️ Khoá bám theo CHUỖI EMAIL NGUYÊN VĂN, không hạ chữ thường — giữ đúng
   * tính chất mà block S8 trong `login()` giải thích: chỉ đúng một cách viết
   * hoa/thường mới khớp được bản ghi, nên attacker không lách được bộ đếm bằng
   * cách đổi hoa/thường.
   */
  private _loginKeys(email: string): { failKey: string; lockKey: string } {
    const h = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
    return { failKey: `login:fail:${h}`, lockKey: `login:lock:${h}` };
  }

  /**
   * Số giây còn lại của khoá, hoặc `-2` nếu không bị khoá.
   *
   * Dùng `TTL` chứ không phải `GET` + `TTL`: một lệnh trả cả HAI thông tin
   * (`-2` = không có khoá · `>= 0` = đang khoá và còn ngần đó giây), tiết kiệm
   * một vòng đi-về trên đường đăng nhập nóng.
   *
   * `-1` (khoá tồn tại nhưng KHÔNG có hạn) không thể xảy ra ở đây vì `SET` bên
   * dưới luôn kèm `EX`. Nếu nó xảy ra thật thì đó đúng là hình dạng của lỗi (a),
   * nên ta cố ý coi như KHÔNG khoá — thà bỏ sót một lần chặn còn hơn nhốt người
   * dùng vĩnh viễn, cùng một logic với fail-open ở trên.
   */
  private async _loginLockTtl(lockKey: string): Promise<number> {
    try {
      return await this.redis.ttl(lockKey);
    } catch (e) {
      this.logger.warn(`[brute-force] Redis TTL lỗi, BỎ QUA khoá (fail-open): ${(e as Error).message}`);
      return -2;
    }
  }

  /**
   * Ghi nhận một lần đăng nhập sai.
   * @returns `true` nếu lần này CHẠM ngưỡng và khoá vừa được đặt.
   *
   * ⚠️ Hàm này KHÔNG ném. Việc ném do bên gọi làm, sau khi hàm trả về.
   * Đó là chủ đích: nếu ném `ForbiddenException` từ trong `try` thì chính
   * `catch` fail-open bên dưới sẽ NUỐT nó và cú gõ sai thứ MAX lại trả 401,
   * tức là khoá được ghi vào Redis nhưng người gọi không hề biết. Tách phần
   * "quyết định" khỏi phần "ném" làm cái bẫy đó không tồn tại được.
   */
  private async _recordLoginFailure(failKey: string, lockKey: string): Promise<boolean> {
    try {
      const n = await this.redis.incr(failKey);
      // Chỉ đặt hạn ở lần ĐẦU: gọi `expire` mỗi lần sẽ đẩy cửa sổ trượt về phía
      // trước vô hạn, biến "5 lần sai trong 15 phút" thành "5 lần sai bao giờ
      // cũng được, miễn cách nhau dưới 15 phút" — tức là bộ đếm không bao giờ
      // quên, đúng lỗi (a) ở dạng khác.
      if (n === 1) await this.redis.expire(failKey, this.loginFailWindowSec);
      if (n < this.loginMaxAttempts) return false;

      await this.redis.set(lockKey, '1', 'EX', this.loginLockSec);
      // ⇐ SỬA LỖI (b): xoá bộ đếm NGAY khi khoá. Hết hạn khoá là bắt đầu lại từ
      // 0 chứ không phải "đã ≥ MAX sẵn rồi, sai một cái là khoá tiếp".
      await this.redis.del(failKey);
      return true;
    } catch (e) {
      this.logger.warn(`[brute-force] Redis lỗi khi đếm lần sai, KHÔNG khoá (fail-open): ${(e as Error).message}`);
      return false;
    }
  }

  /** Xoá sạch bộ đếm + khoá sau một lần đăng nhập thành công. */
  private async _clearLoginFailures(failKey: string, lockKey: string): Promise<void> {
    try {
      await this.redis.del(failKey, lockKey);
    } catch (e) {
      this.logger.warn(`[brute-force] Redis lỗi khi dọn bộ đếm (fail-open): ${(e as Error).message}`);
    }
  }

  // ─── Login ──────────────────────────────────────────────────────────────────

  /**
   * Login bằng email + password.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Dựng cặp khoá Redis từ email (`_loginKeys`) rồi kiểm khoá bằng
   *    `_loginLockTtl`. TTL >= 0 ⇒ đang bị khoá ⇒ ném ForbiddenException.
   * 2. Tìm user bằng email (_findActiveUserByEmail — findFirst + deletedAt: null).
   * 3. Lấy hash để so sánh: nếu user tồn tại → dùng user.password, nếu không → dùng DUMMY_HASH.
   *    Lý do: bcrypt.compare luôn phải chạy để ngăn timing attack.
   * 4. Gọi bcrypt.compare(dto.password, hashToCompare).
   * 5. Nếu user null HOẶC compare sai → `_recordLoginFailure`. Trả `true` (vừa
   *    chạm ngưỡng) → ForbiddenException; ngược lại → UnauthorizedException('Invalid credentials').
   * 6. Nếu hợp lệ → `_clearLoginFailures`, rồi _issueTokenPair(user.id, user.email).
   */
  async login(dto: LoginDto): Promise<TokenPair> {
    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║  S8 — email dùng NGUYÊN VĂN, KHÔNG hạ chữ thường. Đây là chủ đích.     ║
    // ║                                                                       ║
    // ║  Trước đây dòng này là `dto.email.toLowerCase()`, và đó là bug: nó là  ║
    // ║  NƠI DUY NHẤT trong cả file chuẩn hoá email. `register()` (dòng 112,   ║
    // ║  119), `exchange()`, `googleAuth()`, `forgotPassword()` đều ghi và tra ║
    // ║  cứu email nguyên văn. Hệ quả: ai đăng ký bằng `Bao@X.com` thì bản ghi ║
    // ║  lưu đúng `Bao@X.com`, nhưng login lại đi tìm `bao@x.com` → không bao  ║
    // ║  giờ khớp → KHÔNG BAO GIỜ đăng nhập được.                             ║
    // ║                                                                       ║
    // ║  Bỏ `toLowerCase()` làm login nhất quán với 4 nhánh còn lại. Đánh đổi  ║
    // ║  đã được chấp nhận: email trở thành PHÂN BIỆT HOA/THƯỜNG, tức          ║
    // ║  `Bao@X.com` và `bao@x.com` là hai tài khoản khác nhau. Hướng còn lại  ║
    // ║  (chuẩn hoá lúc ghi + cột lowercase có unique index + migrate dữ liệu  ║
    // ║  cũ) đúng hơn về mặt ngữ nghĩa email nhưng đụng dữ liệu đang có.       ║
    // ║                                                                       ║
    // ║  ⚠️ Nếu sau này muốn đổi sang hướng chuẩn hoá, phải sửa ĐỒNG THỜI cả 5 ║
    // ║  nhánh — sửa lẻ một chỗ chính là cách bug này sinh ra lần đầu.         ║
    // ║                                                                       ║
    // ║  Khoá brute-force bên dưới key theo chuỗi email này. Vì chỉ đúng một   ║
    // ║  cách viết hoa/thường mới khớp được bản ghi, attacker không lách được  ║
    // ║  bộ đếm bằng cách đổi hoa/thường: biến thể sai kiểu gì cũng không đăng ║
    // ║  nhập nổi, còn biến thể đúng thì luôn cùng một key ⇒ vẫn khoá sau 5.   ║
    // ╚═══════════════════════════════════════════════════════════════════════╝
    const email = dto.email;
    const { failKey, lockKey } = this._loginKeys(email);

    // Kiểm khoá. Nguồn sự thật là REDIS, không phải bộ nhớ tiến trình: khoá
    // sống sót qua restart API và dùng chung cho mọi instance.
    const lockTtl = await this._loginLockTtl(lockKey);
    if (lockTtl >= 0) {
      throw new ForbiddenException(`Account temporarily locked. Try again in ${lockTtl}s.`);
    }

    // findFirst + deletedAt: null — tài khoản đã xóa coi như không tồn tại.
    // Vẫn chạy bcrypt.compare bên dưới nên attacker không phân biệt được
    // "email không tồn tại" với "email đã bị xóa" qua thời gian phản hồi.
    const user = await this._findActiveUserByEmail(email);

    // Luôn chạy bcrypt.compare để response time giống nhau (chống timing attack)
    const hashToCompare = user?.password || DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !user.password || !valid) {
      // Đếm CẢ email không tồn tại — nếu không, attacker biết ngay email nào có
      // thật (chỉ email thật mới bị khoá) và cửa dò email mở toang. Đây cũng
      // chính là nhánh đã làm `Map` phình vô hạn ở lỗi (a); giờ khoá của nó có
      // TTL nên tự hết hạn.
      const justLocked = await this._recordLoginFailure(failKey, lockKey);
      if (justLocked) {
        throw new ForbiddenException('Too many failed attempts. Account temporarily locked.');
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    await this._clearLoginFailures(failKey, lockKey);

    return this._issueTokenPair(user.id, user.email);
  }

  // ─── Auth.js Exchange (Web) ─────────────────────────────────────────────────

  /**
   * Auth.js gọi sau khi user login bằng Google/GitHub trên Web.
   * Upsert user + account, trả backendToken cho Apollo Client.
   */
  /**
   * Auth.js Exchange — OAuth callback từ Web.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Lấy expectedSecret từ config ('auth.secret').
   * 2. So sánh authSecret với expectedSecret bằng crypto.timingSafeEqual (constant-time).
   *    Lý do: `!==` dùng short-circuit comparison, attacker có thể đo timing để đoán từng byte.
   * 3. Tìm user theo email. Nếu chưa có → tạo user mới.
   * 4. Upsert Account (OAuth provider info).
   * 5. Trả về TokenPair.
   */
  async exchange(dto: ExchangeDto, authSecret: string): Promise<TokenPair> {
    const expectedSecret = this.configService.get<string>('auth.secret')!;

    // Dùng timingSafeEqual để chống timing attack trên secret comparison
    if (!this._timingSafeCompare(authSecret || '', expectedSecret)) {
      throw new ForbiddenException('Invalid auth secret');
    }

    // Upsert user
    let user = await this._findActiveUserByEmail(dto.email);
    if (!user) {
      await this._assertEmailNotSoftDeleted(dto.email);
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          avatarUrl: dto.avatarUrl,
          username: await this._generateUsername(dto.name ?? dto.email),
          emailVerified: new Date(), // OAuth providers đã verify email
        },
      });
    }

    // Upsert OAuth account
    await this.prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: dto.provider,
          providerAccountId: dto.providerAccountId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        type: 'oauth',
        provider: dto.provider,
        providerAccountId: dto.providerAccountId,
      },
    });

    return this._issueTokenPair(user.id, user.email);
  }

  // ─── Refresh Token ──────────────────────────────────────────────────────────

  async refresh(dto: RefreshTokenDto): Promise<{ accessToken: string }> {
    // TODO:
    // 1. Tính mã hash của refreshToken gửi lên bằng hàm _hashToken.
    // 2. Tìm mã hash này trong bảng RefreshToken.
    // 3. Nếu không tìm thấy, hoặc expiresAt < new Date(), xóa token khỏi DB (nếu có) và ném UnauthorizedException.
    // 4. Tìm User tương ứng với userId trong token.
    // 5. Ký (sign) một accessToken mới (dùng _signAccessToken) và trả về { accessToken }.
    
    const tokenHash = this._hashToken(dto.refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');
    if (stored.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { tokenHash } });
      throw new UnauthorizedException('Refresh token expired');
    }

    // `deleteAccount()` có xóa hết refresh token, nên về lý thuyết không tới
    // được đây với tài khoản đã xóa. Vẫn kiểm tra: token có thể được cấp ở một
    // instance khác đúng lúc xóa, và đây là chốt cuối cùng trước khi cấp token.
    const user = await this.prisma.user.findFirst({
      where: { id: stored.userId, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const accessToken = this._signAccessToken(user.id, user.email);
    return { accessToken };
  }

  // ─── Logout ─────────────────────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    // TODO:
    // 1. Hash refreshToken.
    // 2. Xóa tất cả các bản ghi có tokenHash này trong bảng RefreshToken.
    
    const tokenHash = this._hashToken(refreshToken);
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }

  // ─── Google OAuth (Android) ─────────────────────────────────────────────────

  async googleAuth(dto: GoogleAuthDto): Promise<TokenPair> {
    // TODO:
    // 1. Lấy clientId từ config, sau đó gọi hàm _verifyGoogleToken để xác thực idToken với Google.
    // 2. Nếu payload trả về thiếu email, ném BadRequestException.
    // 3. Tìm user trong DB bằng email. Nếu chưa có, tạo user mới tương tự như exchange().
    // 4. Upsert dữ liệu vào bảng Account với provider = 'google'.
    // 5. Trả về TokenPair.
    
    // Verify Google ID Token
    const googleClientId = this.configService.get<string>('google.clientId')!;
    const payload = await this._verifyGoogleToken(dto.idToken, googleClientId);

    if (!payload.email) throw new BadRequestException('Google token missing email');

    let user = await this._findActiveUserByEmail(payload.email);
    if (!user) {
      await this._assertEmailNotSoftDeleted(payload.email);
      user = await this.prisma.user.create({
        data: {
          email: payload.email,
          name: payload.name ?? payload.email,
          avatarUrl: payload.picture,
          username: await this._generateUsername(payload.name ?? payload.email),
          emailVerified: new Date(),
        },
      });
    }

    await this.prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: payload.sub,
        },
      },
      update: {},
      create: {
        userId: user.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: payload.sub,
      },
    });

    return this._issueTokenPair(user.id, user.email);
  }

  // ─── Forgot / Reset Password ─────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    // TODO:
    // 1. Tìm user bằng email. (Nếu không có, cứ return void mà không báo lỗi để bảo mật thông tin).
    // 2. Sinh ra một token ngẫu nhiên (ví dụ: dùng crypto.randomBytes).
    // 3. Xác định thời gian hết hạn (ví dụ: 1 tiếng sau).
    // 4. Upsert token vào bảng VerificationToken với identifier là `reset:${email}`.
    // 5. (Tuỳ chọn) Logic gửi email khôi phục mật khẩu.
    
    // Cùng lỗ hổng với login: tài khoản đã soft-delete không được nhận link
    // đặt lại mật khẩu (không nằm trong danh sách P0 #4 nhưng cùng một lớp lỗi).
    const user = await this._findActiveUserByEmail(email);
    // Không tiết lộ user có tồn tại không
    if (!user) return;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 giờ

    await this.prisma.verificationToken.upsert({
      where: { identifier_token: { identifier: `reset:${email}`, token: rawToken } },
      update: { token: rawToken, expires },
      create: {
        identifier: `reset:${email}`,
        token: rawToken,
        expires,
        userId: user.id,
      },
    });

    // Gửi email reset password
    await this.mailService.sendPasswordResetEmail(email, rawToken);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    // TODO:
    // 1. Tìm VerificationToken trong DB bằng dto.token.
    // 2. Kiểm tra tính hợp lệ: có tồn tại không, identifier có bắt đầu bằng 'reset:' không, token có hết hạn chưa.
    // 3. Hash mật khẩu mới từ dto.password.
    // 4. Cập nhật mật khẩu cho user (tìm user bằng cách lấy email từ identifier).
    // 5. Xóa token đã dùng khỏi bảng VerificationToken.
    
    const record = await this.prisma.verificationToken.findUnique({
      where: { token: dto.token },
    });
    if (!record || !record.identifier.startsWith('reset:')) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (record.expires < new Date()) {
      await this.prisma.verificationToken.delete({ where: { token: dto.token } });
      throw new BadRequestException('Reset token expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const email = record.identifier.replace('reset:', '');

    const user = await this.prisma.user.update({
      where: { email },
      data: { password: passwordHash },
    });

    await this.prisma.verificationToken.delete({ where: { token: dto.token } });

    // ── Hướng C (spec §6.5): đổi mật khẩu = đăng xuất mọi thiết bị khác + gỡ khoá ──
    // (1) Thu hồi TOÀN BỘ refresh token của user ⇒ thiết bị khác mất phiên (lần
    //     refresh kế tiếp 401 → web signOut). Thiết bị vừa đặt lại mật khẩu sẽ
    //     đăng nhập lại bằng mật khẩu mới và nhận cặp token mới.
    await this.prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    // (2) Gỡ khoá brute-force: ai bị khoá 15 phút vì gõ sai 5 lần, đặt lại mật
    //     khẩu xong là đăng nhập được NGAY, không phải chờ hết khoá. Key theo
    //     đúng chuỗi email nguyên văn như limiter (không hạ chữ thường).
    const { failKey, lockKey } = this._loginKeys(email);
    await this._clearLoginFailures(failKey, lockKey);
  }

  // ─── Email Verification ──────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    // TODO:
    // 1. Tìm token trong bảng VerificationToken.
    // 2. Kiểm tra token có hết hạn chưa, có liên kết với userId không.
    // 3. Cập nhật trường emailVerified của user thành ngày hiện tại.
    // 4. Xóa token đã dùng.
    
    const record = await this.prisma.verificationToken.findUnique({ where: { token } });
    if (!record) throw new NotFoundException('Invalid verification token');
    if (record.expires < new Date()) throw new BadRequestException('Token expired');
    if (!record.userId) throw new BadRequestException('Invalid token');

    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    });

    await this.prisma.verificationToken.delete({ where: { token } });
  }

  /**
   * Gửi lại email xác thực (spec §6.3, hướng a+c).
   *
   * Nhận diện người dùng theo thứ tự ưu tiên:
   *   (c) Bearer accessToken hợp lệ → chính chủ (mọi trạng thái của A5);
   *   (a) nếu không có/không hợp lệ → token xác thực CŨ trong body — kể cả đã
   *       hết hạn, vì `verifyEmail` KHÔNG xoá bản ghi hết hạn ⇒ vẫn tra ngược
   *       ra chủ nhân.
   *
   * KHÔNG nhận email ⇒ A5 không cần ô email và không mở cửa dò tài khoản. Im
   * lặng (void → 204) khi không nhận diện được hoặc email đã xác thực rồi —
   * không tiết lộ gì. Chặn tần suất 60s bằng Redis, khoá theo sha256(email)
   * như limiter đăng nhập.
   */
  async resendVerification(token?: string, authorization?: string): Promise<void> {
    let user: { id: string; email: string; emailVerified: Date | null } | null = null;

    // (c) Phiên đăng nhập — verify Bearer bằng đúng secret của access token.
    const bearer = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : null;
    if (bearer) {
      try {
        const payload = this.jwtService.verify<{ sub?: string }>(bearer, {
          secret: this.configService.get<string>('jwt.secret'),
        });
        if (payload?.sub) {
          user = await this.prisma.user.findFirst({
            where: { id: payload.sub, deletedAt: null },
            select: { id: true, email: true, emailVerified: true },
          });
        }
      } catch {
        // Token hỏng/hết hạn — bỏ qua, thử tiếp đường (a).
      }
    }

    // (a) Token xác thực cũ (có thể đã hết hạn) → tra ngược chủ nhân.
    if (!user && token) {
      const record = await this.prisma.verificationToken.findUnique({ where: { token } });
      if (record?.userId && record.identifier.startsWith('verify:')) {
        user = await this.prisma.user.findFirst({
          where: { id: record.userId, deletedAt: null },
          select: { id: true, email: true, emailVerified: true },
        });
      }
    }

    // Không nhận diện được, hoặc đã xác thực rồi → im lặng (không tiết lộ).
    if (!user || user.emailVerified) return;

    // Chặn tần suất: 60s/email. SET NX EX — chỉ đặt được nếu chưa có khoá.
    const h = crypto.createHash('sha256').update(user.email).digest('hex').slice(0, 32);
    const rlKey = `resend:verify:${h}`;
    try {
      const set = await this.redis.set(rlKey, '1', 'EX', 60, 'NX');
      if (set === null) {
        throw new HttpException(
          'Please wait before requesting another verification email',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // Redis chết → fail-open (vẫn gửi), cùng triết lý với brute-force limiter.
      this.logger.warn(
        `[resend-verify] Redis lỗi khi chặn tần suất, BỎ QUA (fail-open): ${(e as Error).message}`,
      );
    }

    // Xoay token: xoá token verify cũ của email này rồi tạo mới (hạn 1 giờ).
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 1000 * 60 * 60);
    await this.prisma.verificationToken.deleteMany({
      where: { identifier: `verify:${user.email}` },
    });
    await this.prisma.verificationToken.create({
      data: { identifier: `verify:${user.email}`, token: rawToken, expires, userId: user.id },
    });
    await this.mailService.sendVerificationEmail(user.email, rawToken);
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async _issueTokenPair(userId: string, email: string): Promise<TokenPair> {
    // TODO:
    // 1. Sinh accessToken (gọi hàm _signAccessToken).
    // 2. Sinh refreshToken (gọi hàm _createRefreshToken).
    // 3. Trả về object chứa cả hai.
    
    const accessToken = this._signAccessToken(userId, email);
    const refreshToken = await this._createRefreshToken(userId);
    return { accessToken, refreshToken };
  }

  private _signAccessToken(userId: string, email: string): string {
    // TODO:
    // 1. Lấy secret và thời hạn từ ConfigService (jwt.secret, jwt.accessExpiresIn).
    // 2. Gọi this.jwtService.sign với payload chứa { sub: userId, email }.
    
    return this.jwtService.sign(
      { sub: userId, email },
      {
        secret: this.configService.get<string>('jwt.secret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiresIn') as any,
      },
    );
  }

  private async _createRefreshToken(userId: string): Promise<string> {
    // TODO:
    // 1. Sinh một chuỗi token ngẫu nhiên.
    // 2. Hash chuỗi token đó (gọi hàm _hashToken).
    // 3. Tính ngày hết hạn (ví dụ: 30 ngày).
    // 4. Tạo một bản ghi mới trong bảng RefreshToken (lưu tokenHash, KHÔNG LƯU token gốc).
    // 5. Trả về chuỗi token ngẫu nhiên ban đầu để gửi về client.
    
    const rawToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this._hashToken(rawToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 ngày

    await this.prisma.refreshToken.create({
      data: { tokenHash, userId, expiresAt },
    });

    return rawToken;
  }

  private _hashToken(token: string): string {
    // TODO:
    // 1. Dùng crypto.createHash('sha256') để băm chuỗi truyền vào.
    // 2. Trả về kết quả dạng 'hex'.
    
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * So sánh 2 chuỗi bằng constant-time algorithm.
   * Ngăn chặn timing attack: so sánh mọi byte bất kể kết quả.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Encode cả 2 string thành Buffer (utf-8).
   * 2. Nếu length khác nhau → vẫn phải so sánh (pad chuỗi ngắn hơn), trả false.
   * 3. Dùng crypto.timingSafeEqual(bufA, bufB) — yêu cầu 2 buffer cùng length.
   * 4. Return kết quả AND điều kiện length bằng nhau.
   */
  private _timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');

    // timingSafeEqual yêu cầu cùng length, nên pad nếu khác
    if (bufA.length !== bufB.length) {
      // So sánh bufB với chính nó để giữ constant time, rồi return false
      crypto.timingSafeEqual(bufB, bufB);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }

  private async _generateUsername(name: string): Promise<string> {
    // TODO:
    // 1. Chuẩn hóa name thành một chuỗi base: viết thường, loại bỏ ký tự không phải chữ/số, cắt độ dài.
    // 2. Kiểm tra vòng lặp: tìm xem username này có trong DB chưa.
    // 3. Nếu chưa có -> trả về.
    // 4. Nếu có rồi -> nối thêm số đếm ở cuối và kiểm tra lại.
    
    const base = name
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'user';

    let username = base;
    let attempt = 0;

    while (true) {
      const exists = await this.prisma.user.findUnique({ where: { username } });
      if (!exists) return username;
      attempt++;
      username = `${base}${attempt}`;
    }
  }

  /**
   * Hỏi Google xem `idToken` có thật không.
   *
   * ⚠️ BA HÌNH DẠNG HỎNG KHÁC NHAU, ĐỪNG GỘP LÀM MỘT (sửa 25/08/2026, nợ ghi từ M2):
   *
   *   1. **Google trả lời "token sai"** (`!res.ok`) ⇒ **401**. Lỗi của người gọi.
   *   2. **Không hỏi được Google** (DNS chết, ETIMEDOUT, proxy chặn) ⇒ **503**.
   *      KHÔNG phải lỗi của người gọi, và cũng không phải lỗi lập trình.
   *   3. `aud` lệch ⇒ 401: token thật nhưng của ứng dụng khác.
   *
   * Bản cũ để `fetch` ném xuyên qua, nên hình dạng (2) rơi vào bộ lọc mặc định
   * của Nest và ra **500 Internal Server Error** — một câu nói dối có hậu quả
   * thật: 500 nghĩa là "server này hỏng, đừng thử lại", client Android sẽ báo
   * người dùng sai sự thật, còn giám sát thì đếm sự cố mạng thành lỗi sản phẩm.
   * Bằng chứng: ngày 25/08 mạng ra `oauth2.googleapis.com` timeout, phép kiểm
   * `00-auth.mjs` đỏ với 500 và mất nửa buổi mới lần ra nguyên nhân nằm ngoài
   * máy. 503 nói đúng thứ đang xảy ra: tạm thời, thử lại được.
   *
   * `AbortSignal.timeout` có mặt vì hình dạng (2) không phải lúc nào cũng
   * "hỏng ngay": một endpoint treo sẽ giữ request cho tới khi client bỏ cuộc.
   */
  private async _verifyGoogleToken(idToken: string, clientId: string) {
    let res: Response;
    try {
      res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`, {
        signal: AbortSignal.timeout(GOOGLE_TOKENINFO_TIMEOUT_MS),
      });
    } catch (e) {
      // Thông điệp KHÔNG nhắc Google/endpoint/timeout: người gọi chỉ cần biết
      // "tạm thời chưa xác minh được, thử lại". Chi tiết đi vào log của server.
      this.logger.warn(
        `[google-auth] không gọi được tokeninfo của Google (${(e as Error).name}): ${(e as Error).message}`,
      );
      throw new ServiceUnavailableException('Could not verify sign-in right now. Please try again.');
    }

    if (!res.ok) throw new UnauthorizedException('Invalid Google token');

    const payload = await res.json();
    if (payload.aud !== clientId) throw new UnauthorizedException('Google token audience mismatch');

    return payload as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
      aud: string;
    };
  }
}
