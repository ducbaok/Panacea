import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * FE-0 QĐ-B/1b — codegen riêng cho apps/web.
 *
 * `packages/graphql-types` giữ ĐÚNG một trách nhiệm: type của SCHEMA.
 * File này sinh type + typed-document-node cho từng OPERATION của web (query,
 * mutation, subscription trong `**\/*.graphql`). Không gộp vào package chung để
 * package đó không phụ thuộc ngược lên app.
 *
 * QUY TRÌNH BẮT BUỘC KHI SCHEMA ĐỔI:
 *   1. Sửa resolver ở apps/api.
 *   2. RESTART API — `schema.graphql` được sinh lúc BOOT (app.module.ts:57),
 *      KHÔNG phải lúc `nest build`.
 *   3. Chạy `pnpm codegen`.
 * Chạy codegen trên SDL cũ cho ra types "xanh mà sai" và không `tsc` nào bắt được.
 *
 * ⚠️ Đừng dùng mtime của schema.graphql để phán đoán độ mới — API ghi lại file
 * mỗi lần boot dù nội dung không đổi. Grep NỘI DUNG, đừng tin dấu thời gian.
 */
const config: CodegenConfig = {
  schema: '../../apps/api/schema.graphql',
  documents: ['app/**/*.graphql', 'graphql/**/*.graphql', 'lib/**/*.graphql'],
  ignoreNoDocuments: true,
  generates: {
    'lib/gql/': {
      preset: 'client',
      presetConfig: {
        // fragmentMasking OFF — dự án chưa dùng fragment thật; bật lên tăng chi
        // phí học mà không mua được gì ở FE-0.
        fragmentMasking: false,
      },
      config: {
        useTypeImports: true,
        // Đồng bộ với packages/graphql-types: DateTime → string (backend serialize ISO).
        scalars: {
          DateTime: 'string',
        },
      },
    },
  },
};

export default config;
