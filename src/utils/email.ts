import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false, // TLS via STARTTLS on port 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendOtpEmail(
  email: string,
  otp: string,
  firstName: string,
): Promise<void> {
  const from = process.env.FROM_EMAIL || process.env.SMTP_USER;

  await transporter.sendMail({
    from: `"Biddaro" <${from}>`,
    to: email,
    subject: `${otp} is your Biddaro verification code`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:#ea580c;padding:24px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                🏗️ Biddaro
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Verify your email address</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;">
                Hi ${firstName}, thanks for joining Biddaro! Enter the code below to activate your account.
              </p>
              <!-- OTP box -->
              <div style="background:#fff7ed;border:2px solid #fed7aa;border-radius:12px;
                          padding:24px;text-align:center;margin-bottom:24px;">
                <p style="margin:0 0 4px;font-size:12px;color:#9a3412;font-weight:600;
                           text-transform:uppercase;letter-spacing:1px;">Your verification code</p>
                <p style="margin:0;font-size:48px;font-weight:800;letter-spacing:14px;color:#1f2937;
                           font-family:'Courier New',monospace;">
                  ${otp}
                </p>
              </div>
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
                ⏱ This code expires in <strong>10 minutes</strong>.
              </p>
              <p style="margin:0;color:#6b7280;font-size:13px;">
                🔒 Never share this code with anyone. Biddaro will never ask for it.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #f3f4f6;background:#f9fafb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                If you didn't create a Biddaro account, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  });
}
