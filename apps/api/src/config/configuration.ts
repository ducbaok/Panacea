import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // App
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(4000),
  WEB_URL: Joi.string().default('http://localhost:3000'),

  // Database
  DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_URL: Joi.string().required(),

  // JWT
  BACKEND_JWT_SECRET: Joi.string().min(32).required(),
  REFRESH_TOKEN_SECRET: Joi.string().min(32).required(),

  // Auth.js exchange
  AUTH_SECRET: Joi.string().min(32).required(),

  // AWS
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  AWS_REGION: Joi.string().default('ap-southeast-1'),
  S3_BUCKET_NAME: Joi.string().required(),
  S3_PROCESSED_BUCKET: Joi.string().required(),
  CLOUDFRONT_DOMAIN: Joi.string().required(),

  // Google (Android OAuth)
  GOOGLE_CLIENT_ID: Joi.string().required(),

  // Firebase
  FIREBASE_SERVICE_ACCOUNT: Joi.string().required(),

  // Internal (Lambda callback)
  INTERNAL_API_SECRET: Joi.string().min(16).required(),

  // Brute-force limiter của login (Redis) — optional, default nằm ở `configuration()`.
  // `.integer().min(1)` cố ý: `LOGIN_LOCK_SEC=abc` phải chết lúc BOOT chứ không
  // được biến thành NaN rồi lặng lẽ vô hiệu hoá khoá lúc chạy.
  LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(1).optional(),
  LOGIN_FAIL_WINDOW_SEC: Joi.number().integer().min(1).optional(),
  LOGIN_LOCK_SEC: Joi.number().integer().min(1).optional(),

  // Rate-limit đường TẠO PIN (XH-4b · XH-QĐ-12) — optional, default ở
  // `configuration()`. `.integer().min(1)` cùng lý do với `LOGIN_*`:
  // `PIN_CREATE_PER_MIN=abc` phải chết lúc BOOT chứ không được thành NaN rồi
  // lặng lẽ chặn MỌI pin (`n > NaN` là false ⇒ thực ra là lặng lẽ TẮT trần —
  // giới hạn chống lạm dụng DUY NHẤT của đường tạo pin biến mất không tiếng động).
  PIN_CREATE_PER_MIN: Joi.number().integer().min(1).optional(),

  // Mail (Gmail SMTP)
  MAIL_HOST: Joi.string().optional(),
  MAIL_PORT: Joi.number().optional(),
  MAIL_USER: Joi.string().optional(),
  MAIL_PASS: Joi.string().optional(),
  MAIL_FROM: Joi.string().optional(),

  // App
  APP_BASE_URL: Joi.string().optional(),
});

export const configuration = () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '4000', 10),
  webUrl: process.env.WEB_URL,

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  jwt: {
    secret: process.env.BACKEND_JWT_SECRET,
    refreshSecret: process.env.REFRESH_TOKEN_SECRET,
    accessExpiresIn: '15m',
    refreshExpiresIn: '30d',
  },

  auth: {
    secret: process.env.AUTH_SECRET,

    /**
     * Brute-force limiter của `AuthService.login()`. Ba số này tồn tại KHÔNG
     * phải để tinh chỉnh sản xuất mà để **kiểm chứng được**: với 900 giây
     * hard-code thì phép "hết khoá rồi gõ sai lại phải là 401 chứ không phải
     * khoá tiếp 15 phút" (lỗi (b)) chỉ đo được sau 15 phút chờ, tức là không
     * ai đo. Đặt `LOGIN_LOCK_SEC=5` rồi restart API là đo được trong 10 giây.
     */
    login: {
      maxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10),
      failWindowSec: parseInt(process.env.LOGIN_FAIL_WINDOW_SEC || '900', 10),
      lockSec: parseInt(process.env.LOGIN_LOCK_SEC || '900', 10),
    },
  },

  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    s3BucketName: process.env.S3_BUCKET_NAME,
    s3ProcessedBucket: process.env.S3_PROCESSED_BUCKET,
    cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN,
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
  },

  firebase: {
    serviceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
  },

  internal: {
    apiSecret: process.env.INTERNAL_API_SECRET,
  },

  mail: {
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT || '587', 10),
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || 'Antigravity <noreply@antigravity.app>',
  },

  app: {
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',
  },

  pins: {
    /**
     * Trần tạo pin theo PHÚT của một người (XH-4b — XH-QĐ-12, duyệt 21/08/2026).
     *
     * Đây là giới hạn chống lạm dụng DUY NHẤT còn lại trên đường tạo pin sau
     * khi trần 20 pin/NGÀY bị bỏ (XH-QĐ-8): dự án đã chốt không có
     * moderation/report, nên không còn lớp nào khác chặn một script đăng ảnh
     * hàng loạt. Xem `docs/xahoi-phi-chuc-nang.md` §1.5 + §4.
     *
     * Để được ở đây (chứ không hard-code trong service) vì đúng một lý do như
     * `auth.login`: **kiểm chứng được**. `77-pin-rate.mjs` đọc chính biến này
     * rồi đăng đúng `N + 1` pin — hạ `PIN_CREATE_PER_MIN=3` là bước đó chạy
     * nhanh gấp ba mà vẫn đo đúng cái trần đang chạy thật.
     */
    createPerMin: parseInt(process.env.PIN_CREATE_PER_MIN || '10', 10),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
