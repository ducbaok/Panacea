import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HT-1 (Luồng 3, báo trước Luồng 1): build standalone để đóng image Web gọn —
  // sinh `.next/standalone/` (server.js + node_modules tối thiểu). Xem apps/web/Dockerfile.
  output: "standalone",
};

export default nextConfig;
