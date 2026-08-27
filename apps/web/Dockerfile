# syntax=docker/dockerfile:1

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  apps/web — Next.js 16 (standalone)  ·  image production                   ║
# ║  Build context = ROOT của monorepo (pnpm workspace):                       ║
# ║    docker build -f apps/web/Dockerfile -t antigravity-web .                ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
#
# Lưu ý đặc thù dự án:
#  • output: 'standalone' đã bật ở apps/web/next.config.ts (Luồng 3 sửa, báo Luồng 1).
#    Next trace tự động ROOT của workspace (pnpm-lock.yaml ở root) ⇒ standalone
#    nằm ở `.next/standalone/apps/web/server.js` + `.next/standalone/node_modules`.
#  • codegen: turbo.json khai `build.dependsOn = [...,"codegen",...]` ⇒ chỉ gọi
#    `turbo run build`; web `codegen` (graphql-codegen) đọc apps/api/schema.graphql
#    (CÓ commit) và sinh lib/gql trước `next build`. KHÔNG chèn codegen thủ công.
#  • standalone KHÔNG gói `.next/static` và `public` — phải COPY tay (xem dưới).
#  • NEXT_PUBLIC_* là BUILD-TIME (Next inline lúc build). Deploy thật PHẢI truyền
#    chúng qua --build-arg — xem khối ARG ở stage `build` bên dưới.

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ── build: install → turbo build (kéo theo codegen của web) ──────────────────
FROM base AS build
RUN corepack prepare pnpm@9.0.0 --activate

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  🔴 BỐN BIẾN NÀY QUYẾT ĐỊNH IMAGE CHẠY ĐƯỢC HAY KHÔNG — 27/08/2026        ║
# ║                                                                           ║
# ║  Next inline `NEXT_PUBLIC_*` vào bundle JS lúc `next build`. Đặt chúng ở  ║
# ║  task definition của ECS KHÔNG có tác dụng cho code chạy trong trình      ║
# ║  duyệt. Trước bản này Dockerfile không khai ARG nào, nên image production ║
# ║  nướng sẵn giá trị fallback trong `lib/apollo/client.ts`:                 ║
# ║      http://localhost:4000/graphql  ·  ws://localhost:4000/graphql        ║
# ║  ⇒ trình duyệt của NGƯỜI DÙNG gọi về máy của CHÍNH HỌ. Trang vẫn tải      ║
# ║  (HTML render phía server), chỉ mọi dữ liệu là rỗng — hình dạng sự cố     ║
# ║  trông y hệt "API chết", nên rất dễ đi tìm sai chỗ trên AWS.              ║
# ║                                                                           ║
# ║  Không đặt giá trị mặc định cho ba biến URL: mặc định sai âm thầm còn tệ  ║
# ║  hơn build lỗi. Rỗng ⇒ code rơi về fallback localhost, và bước nghiệm thu ║
# ║  (`GET /` rồi grep bundle) bắt được ngay.                                 ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GRAPHQL_URL
ARG NEXT_PUBLIC_WS_URL
# 's3' cho production (bắt buộc — /uploads/local bị API chặn khi NODE_ENV=production),
# 'local' cho dev. Xem docblock UPLOAD_MODE trong apps/web/lib/upload.ts.
ARG NEXT_PUBLIC_UPLOAD_MODE=local

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GRAPHQL_URL=$NEXT_PUBLIC_GRAPHQL_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_UPLOAD_MODE=$NEXT_PUBLIC_UPLOAD_MODE

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=web...

# ── runtime: chỉ server standalone + static + public ─────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Server tối thiểu + node_modules đã trace (layout mirror từ root workspace).
COPY --from=build /app/apps/web/.next/standalone ./
# static + public không nằm trong standalone — copy riêng, đúng vị trí tương đối.
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
