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
#  • NEXT_PUBLIC_* là BUILD-TIME (Next inline lúc build). Deploy thật cần truyền
#    chúng qua --build-arg; image này build được mà không có chúng (giá trị rỗng).

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# ── build: install → turbo build (kéo theo codegen của web) ──────────────────
FROM base AS build
RUN corepack prepare pnpm@9.0.0 --activate
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
