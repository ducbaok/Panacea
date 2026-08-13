import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/*
 * FE-1b — Font Be Vietnam Pro (thay Geist/Geist_Mono).
 *
 * subsets: BẮT BUỘC có 'vietnamese', nếu thiếu, chữ có dấu sẽ rơi về font hệ
 *   thống (fallback) và chỉ lộ ra ở chữ Việt — build vẫn xanh.
 * weight: 400/600/700/800 (mockup dùng 4 độ đậm này; kiểm bằng grep).
 * variable: khớp `--font-be-vietnam-pro` mà globals.css @theme ánh xạ vào
 *   `--font-sans`. Đổi tên biến ở đây thì phải đổi cả globals.css.
 */
const beVietnamPro = Be_Vietnam_Pro({
  variable: "--font-be-vietnam-pro",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Antigravity",
  description: "Antigravity — nơi lưu và khám phá cảm hứng bằng hình ảnh.",
};

/*
 * FE-1a — script chống nháy màu.
 *
 * PHẢI chạy SYNC trước paint đầu tiên, nếu không sẽ có 1 khung hình sáng loé
 * lên trước khi CSS dark áp dụng. Đặt trong <head> bằng dangerouslySetInnerHTML
 * là cách duy nhất cho phép chạy TRƯỚC React hydration.
 *
 * Logic 3 nhánh khớp `ThemeToggle` (components/theme-toggle.tsx):
 *   • localStorage['theme'] === 'light'  → data-theme="light"
 *   • localStorage['theme'] === 'dark'   → data-theme="dark"
 *   • bất kỳ giá trị nào khác / chưa set → KHÔNG đặt attribute (chế độ "hệ thống"),
 *     CSS bám @media (prefers-color-scheme: dark) tự chọn nền.
 *
 * suppressHydrationWarning trên <html> là bắt buộc: script này thay đổi
 * attribute trước khi React so sánh DOM ⇒ nếu không suppress, React sẽ báo
 * hydration mismatch mỗi lần user chọn "tối" hoặc "sáng" chủ động.
 */
const antiFlashScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${beVietnamPro.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: antiFlashScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
