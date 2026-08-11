import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * MailService — gửi email qua SMTP (Nodemailer + Gmail).
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Inject ConfigService để đọc cấu hình SMTP.
 * 2. Tạo transporter trong constructor (hoặc lazy init).
 * 3. Nếu MAIL_USER rỗng → fallback console.log (dev mode).
 * 4. sendMail(to, subject, html) → gọi transporter.sendMail().
 * 5. sendVerificationEmail(email, token) → tạo link verify + gọi sendMail.
 * 6. sendPasswordResetEmail(email, token) → tạo link reset + gọi sendMail.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    const user = this.configService.get<string>('mail.user');
    const pass = this.configService.get<string>('mail.pass');

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('mail.host'),
        port: this.configService.get<number>('mail.port'),
        secure: false, // true for 465, false for 587
        auth: { user, pass },
      });
      this.logger.log('Mail transporter initialized (SMTP)');
    } else {
      this.logger.warn('MAIL_USER/MAIL_PASS not set — emails will be logged to console (dev mode)');
    }
  }

  /**
   * Gửi email. Nếu transporter chưa cấu hình → log ra console.
   */
  async sendMail(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV] Email to: ${to}`);
      this.logger.log(`[DEV] Subject: ${subject}`);
      this.logger.log(`[DEV] Body: ${html}`);
      return;
    }

    try {
      const from = this.configService.get<string>('mail.from');
      await this.transporter.sendMail({ from, to, subject, html });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      // Không throw — email failure không nên block user flow
    }
  }

  /**
   * Gửi email xác thực tài khoản.
   */
  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const baseUrl = this.configService.get<string>('app.baseUrl') || 'http://localhost:4000';
    const verifyUrl = `${baseUrl}/auth/verify-email?token=${token}`;

    const html = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #e60023;">🪐 Antigravity — Xác thực email</h2>
        <p>Chào bạn,</p>
        <p>Cảm ơn bạn đã đăng ký tài khoản. Vui lòng click nút bên dưới để xác thực email:</p>
        <a href="${verifyUrl}" style="display: inline-block; background: #e60023; color: white; padding: 12px 24px; text-decoration: none; border-radius: 24px; font-weight: bold; margin: 16px 0;">Xác thực email</a>
        <p style="color: #666; font-size: 14px;">Hoặc copy link này vào trình duyệt:<br/>${verifyUrl}</p>
        <p style="color: #999; font-size: 12px;">Link có hiệu lực trong 1 giờ.</p>
      </div>
    `;

    await this.sendMail(email, 'Xác thực email — Antigravity', html);
  }

  /**
   * Gửi email khôi phục mật khẩu.
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const baseUrl = this.configService.get<string>('app.baseUrl') || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    const html = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #e60023;">🪐 Antigravity — Đặt lại mật khẩu</h2>
        <p>Chào bạn,</p>
        <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
        <a href="${resetUrl}" style="display: inline-block; background: #e60023; color: white; padding: 12px 24px; text-decoration: none; border-radius: 24px; font-weight: bold; margin: 16px 0;">Đặt lại mật khẩu</a>
        <p style="color: #666; font-size: 14px;">Hoặc copy link này vào trình duyệt:<br/>${resetUrl}</p>
        <p style="color: #999; font-size: 12px;">Link có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
      </div>
    `;

    await this.sendMail(email, 'Đặt lại mật khẩu — Antigravity', html);
  }
}
