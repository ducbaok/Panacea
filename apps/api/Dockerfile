# syntax=docker/dockerfile:1

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║  apps/api — NestJS + Prisma  ·  image production                           ║
# ║  Build context = ROOT của monorepo (pnpm workspace), KHÔNG phải apps/api:  ║
# ║    docker build -f apps/api/Dockerfile -t antigravity-api .                ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
#
# BỐN bẫy đặc thù dự án (HT-1) — cả bốn KHÔNG nổ lúc build, chỉ nổ lúc CHẠY:
#
#  1) `@antigravity/database` là package RAW-TS: package.json `main = src/index.ts`
#     và KHÔNG có bước build. Nó chỉ chạy được nhờ TYPE-STRIPPING mặc định của
#     Node ≥ 22.18. Đã đo trên máy này (Node 24.15): `require('@antigravity/database')`
#     trả về PrismaClient/ReactionType/…; Node 20 KHÔNG có type-stripping ⇒ sẽ nổ
#     "Unknown file extension .ts" ở lần import đầu tiên lúc runtime.
#     ⇒ base image PHẢI là Node 24 (khớp máy dev), KHÔNG phải Node 20 như kế
#       hoạch cũ ghi.
#     ⇒ Hệ quả sống-còn: type-stripping bị VÔ HIỆU khi file .ts nằm DƯỚI
#       node_modules. pnpm giữ `node_modules/@antigravity/database` là SYMLINK trỏ
#       ra `packages/database` (realpath NGOÀI node_modules) nên vẫn strip được.
#       Vì thế image PHẢI giữ nguyên layout workspace + symlink — TUYỆT ĐỐI không
#       `pnpm deploy` / prune làm phẳng package này vào node_modules (làm phẳng =
#       nổ ở query đầu tiên). Đây là lý do runtime stage COPY nguyên /app.
#
#  2) `prisma generate` PHẢI chạy TRONG image. Engine query là binary theo nền
#     tảng; bản Windows trên đĩa vô dụng trong container Linux. .dockerignore đã
#     loại `packages/database/src/client` để bước generate dựng lại bản Linux sạch.
#
#  3) codegen: turbo.json đã khai `build.dependsOn = ["^build","codegen","^codegen"]`
#     ⇒ chỉ gọi `turbo run build`, KHÔNG tự chèn bước codegen (tránh hai nguồn
#     sự thật). `apps/api/schema.graphql` CÓ commit nên build được — lưu ý SDL
#     thực ra sinh lúc API BOOT, nên HT-2 (CI) mới là chỗ canh SDL cũ, không phải đây.
#
#  4) KHÔNG copy `apps/api/uploads/` (134 file ảnh test) — .dockerignore đã loại.

# ─────────────────────────────────────────────────────────────────────────────
# base — Node 24 (xem bẫy #1) + openssl cho prisma engine + corepack cho pnpm@9
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS base
# openssl: Prisma query-engine cần libssl lúc chạy trên debian-slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# build — install (kèm devDeps) → prisma generate → turbo build
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS build
# Kích hoạt đúng pnpm@9.0.0 theo packageManager ở root package.json.
RUN corepack prepare pnpm@9.0.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
# Prisma client (engine Linux) TRƯỚC build — thiếu ⇒ nổ ở query đầu lúc runtime.
RUN pnpm --filter @antigravity/database exec prisma generate
# Chỉ turbo build; codegen đã là dependsOn trong turbo.json. `api...` = api + deps.
RUN pnpm turbo run build --filter=api...

# ─────────────────────────────────────────────────────────────────────────────
# runtime — GIỮ NGUYÊN workspace + symlink (bẫy #1). COPY bảo toàn symlink.
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=build /app /app
# Chạy từ trong apps/api để `node dist/main` + symlink `@antigravity/database`
# (và type-stripping của Node 24) còn hiệu lực. `start:prod` = `node dist/main`.
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main"]
