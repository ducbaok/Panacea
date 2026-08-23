import type { Metadata } from "next";
import { Be_Vietnam_Pro, Varela_Round } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

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

/*
 * FE-2 — Font tiêu đề Varela Round (mockup Panacea dùng cho chữ thương hiệu
 * và mọi <h1>; xuất hiện 21 lần trong Panacea.html).
 *
 * weight: chỉ 400 — Google Fonts KHÔNG có bản in đậm cho font này; đừng khai
 *   "700" như phản xạ, next/font sẽ throw ở build. Muốn đậm hơn ở chữ thương
 *   hiệu, dùng letter-spacing hoặc size lớn — không phải font-weight.
 * subsets: có 'vietnamese' cho tiêu đề tiếng Việt (Antigravity chạy vi trước).
 * variable: khớp --font-varela-round mà @theme ánh xạ vào --font-display.
 */
const varelaRound = Varela_Round({
  variable: "--font-varela-round",
  subsets: ["latin", "vietnamese"],
  weight: "400",
  display: "swap",
});

/*
 * i18n (23/08/2026) — metadata phải THEO NGÔN NGỮ nên không còn là hằng số
 * `export const metadata` được: đổi sang `generateMetadata` để đọc cookie
 * locale mỗi request. Giữ nguyên `export const metadata` thì thẻ <title> và
 * description luôn tiếng Việt kể cả khi người dùng đã chọn English.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: "Antigravity",
    description: translate(locale, "common.appDescription"),
  };
}

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Đọc cookie `locale` ở SERVER ⇒ HTML đầu tiên đã đúng ngôn ngữ, không có
  // khoảnh khắc chữ Việt loé lên rồi mới đổi sang tiếng Anh (đây là lý do
  // ngôn ngữ KHÔNG dùng lại mẹo `mounted` guard của ThemeToggle).
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${beVietnamPro.variable} ${varelaRound.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: antiFlashScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers initialLocale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
