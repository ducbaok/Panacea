import { ThemeToggle } from "@/components/theme-toggle";

/*
 * FE-1b — trang MẪU (không phải màn thật).
 *
 * Mục đích duy nhất: bày các token màu/font để mắt người và phép T2 kiểm được.
 * FE-2 sẽ thay bằng shell chính; FE-6 mới có trang chủ thật. Nếu đang đọc file
 * này để copy layout — dừng lại: đây không phải chuẩn.
 */
export default function Home() {
  return (
    <main
      className="min-h-full flex flex-col gap-8 px-8 py-10"
      style={{
        background: "var(--color-background)",
        color: "var(--color-foreground)",
      }}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold">
          Antigravity — Khám phá · Đã lưu · Bảng ghim
        </h1>
        <p style={{ color: "var(--color-muted)" }} className="text-sm">
          Trang mẫu FE-1b: dùng để mắt kiểm bảng màu Panacea và font Be Vietnam Pro
          hiện dấu tiếng Việt đúng.
        </p>
        <ThemeToggle />
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Nền · chữ · viền
        </h2>
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <p className="text-sm">
            Ô này dùng <code>--color-surface</code> +{" "}
            <code>--shadow-card</code>. Dấu tiếng Việt phải sắc nét: <em>ượ, ầ, ĩ, ự, ắ, ệ</em>.
          </p>
          <p
            style={{ color: "var(--color-muted)" }}
            className="text-xs mt-2"
          >
            Chữ mờ (<code>--color-muted</code>) — dùng cho meta thời gian, chú thích.
          </p>
        </div>
        <div
          className="rounded-[var(--radius-card)] p-4 text-sm"
          style={{
            background: "var(--color-surface-muted)",
            border: "1px solid var(--color-border)",
          }}
        >
          Ô này dùng <code>--color-surface-muted</code> — nền phân đoạn nhạt.
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Primary — nền + chữ + link
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-[var(--radius-button)] px-5 py-2 text-sm font-semibold"
            style={{
              background: "var(--color-primary)",
              color: "var(--color-primary-foreground)",
            }}
          >
            Nút primary
          </button>
          <span
            className="rounded-[var(--radius-button)] px-4 py-2 text-sm"
            style={{ background: "var(--color-primary-soft)" }}
          >
            Nền primary-soft
          </span>
          <a
            href="#"
            className="text-sm font-semibold"
            style={{ color: "var(--color-primary-strong)" }}
          >
            Link primary-strong →
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Trạng thái — danger · success · overlay
        </h2>
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <span
            className="rounded-[var(--radius-input)] px-3 py-1.5"
            style={{
              background: "var(--color-danger)",
              color: "var(--color-danger-foreground)",
            }}
          >
            Lỗi (danger)
          </span>
          <span
            className="rounded-[var(--radius-input)] px-3 py-1.5"
            style={{
              background: "var(--color-success)",
              color: "var(--color-success-foreground)",
            }}
          >
            Xong (success)
          </span>
          <span
            className="rounded-[var(--radius-input)] px-3 py-1.5"
            style={{
              background: "var(--color-overlay)",
              color: "#fff",
            }}
          >
            overlay (dùng phủ nền modal)
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Placeholder ảnh (dùng ở FE-3)
        </h2>
        <div className="flex gap-3">
          <div
            className="rounded-[var(--radius-card)] w-40 h-40"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--color-placeholder-a1) 0 14px, var(--color-placeholder-b1) 14px 28px)",
            }}
            aria-label="Vân sọc placeholder tông 1"
          />
          <div
            className="rounded-[var(--radius-card)] w-40 h-40"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--color-placeholder-a2) 0 14px, var(--color-placeholder-b2) 14px 28px)",
            }}
            aria-label="Vân sọc placeholder tông 2"
          />
        </div>
      </section>
    </main>
  );
}
