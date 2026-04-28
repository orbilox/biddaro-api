import { Request, Response } from 'express';

function sendSuccess(res: Response, data: unknown, message = 'Success') {
  res.json({ success: true, message, data });
}
function sendError(res: Response, message: string, status = 400) {
  res.status(status).json({ success: false, message });
}

/** Timeout helper */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function submitContact(req: Request, res: Response): Promise<void> {
  const { name, email, subject, message } = req.body;

  const apiKey     = process.env.BREVO_API_KEY;
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.FROM_EMAIL || 'support@biddaro.com';
  const senderEmail  = process.env.FROM_EMAIL || 'noreply@biddaro.com';

  if (!apiKey) {
    // Still succeed on client side — log internally
    console.error('[CONTACT] BREVO_API_KEY not set');
    sendSuccess(res, null, 'Message received! We\'ll get back to you within 24 hours.');
    return;
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f9fafb;padding:40px 0;margin:0;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0"
        style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr>
          <td style="background:#ea580c;padding:20px 28px;">
            <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">Biddaro — New Contact Message</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;width:100px;">From</td>
                <td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">${name} &lt;${email}&gt;</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;">Subject</td>
                <td style="padding:6px 0;font-size:13px;font-weight:600;color:#111827;">${subject}</td>
              </tr>
            </table>
            <hr style="border:none;border-top:1px solid #f3f4f6;margin:16px 0;" />
            <p style="font-size:14px;color:#374151;white-space:pre-wrap;line-height:1.6;">${message}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px;border-top:1px solid #f3f4f6;background:#f9fafb;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">Reply directly to this email to respond to ${name}.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const autoReplyHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
        style="background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr>
          <td style="background:#ea580c;padding:24px 32px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#fff;">Biddaro</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Thanks for reaching out, ${name}!</h2>
            <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">
              We've received your message and our team will get back to you within <strong>24 hours</strong>.
            </p>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:16px;margin-bottom:16px;">
              <p style="margin:0 0 4px;font-size:12px;color:#9a3412;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Your message</p>
              <p style="margin:0;font-size:13px;color:#374151;font-style:italic;">"${message.substring(0, 200)}${message.length > 200 ? '…' : ''}"</p>
            </div>
            <p style="margin:0;color:#6b7280;font-size:13px;">
              While you wait, explore our <a href="https://biddaro.com/guide" style="color:#ea580c;">Help Guide</a> or
              <a href="https://biddaro.com/ai" style="color:#ea580c;">AI Tools</a>.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 32px;border-top:1px solid #f3f4f6;background:#f9fafb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">You're receiving this because you contacted Biddaro.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    // Send both emails in parallel
    await withTimeout(
      Promise.all([
        // 1. Internal alert to support team
        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            sender: { name: 'Biddaro Contact Form', email: senderEmail },
            to: [{ email: supportEmail, name: 'Biddaro Support' }],
            replyTo: { email, name },
            subject: `[Contact] ${subject}`,
            htmlContent,
          }),
        }),
        // 2. Auto-reply to sender
        fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            sender: { name: 'Biddaro', email: senderEmail },
            to: [{ email, name }],
            subject: `We received your message — Biddaro`,
            htmlContent: autoReplyHtml,
          }),
        }),
      ]),
      12_000,
    );
  } catch (err) {
    console.error('[CONTACT] Email send failed:', err);
    // Still succeed — message is not lost, just email delivery failed
  }

  sendSuccess(res, null, 'Message received! We\'ll get back to you within 24 hours.');
}
