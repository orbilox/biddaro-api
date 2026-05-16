// Brevo Transactional Email API (HTTPS port 443 — works on Railway, no SMTP port blocking)
// Docs: https://developers.brevo.com/reference/sendtransacemail

// ─── Shared Brevo send helper ──────────────────────────────────────────────────

async function brevoSend(payload: object): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY env var is not set');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Brevo API ${res.status}: ${await res.text()}`);
}

const SENDER = () => ({
  name: 'Biddaro',
  email: process.env.FROM_EMAIL || 'noreply@biddaro.com',
});

const FRONTEND = () => process.env.FRONTEND_URL || 'https://biddaro.com';

/** Minimal branded wrapper — orange header + white body + CTA button. */
function brandedHtml(opts: {
  preheader: string;
  bodyTitle: string;
  bodyLines: string[];
  ctaLink?: string;
  ctaLabel?: string;
  footerNote?: string;
}): string {
  const cta = opts.ctaLink && opts.ctaLabel
    ? `<div style="text-align:center;margin:24px 0;">
         <a href="${opts.ctaLink}"
            style="display:inline-block;background:#ea580c;color:#fff;font-size:14px;font-weight:700;
                   padding:13px 28px;border-radius:10px;text-decoration:none;">
           ${opts.ctaLabel}
         </a>
       </div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0"
        style="background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="background:#ea580c;padding:22px 32px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.5px;">Biddaro</p>
        </td></tr>
        <tr><td style="padding:30px 32px;">
          <h2 style="margin:0 0 8px;font-size:18px;color:#111827;">${opts.bodyTitle}</h2>
          ${opts.bodyLines.map(l => `<p style="margin:0 0 10px;color:#4b5563;font-size:14px;line-height:1.6;">${l}</p>`).join('')}
          ${cta}
          ${opts.footerNote ? `<p style="margin:0;color:#9ca3af;font-size:12px;">${opts.footerNote}</p>` : ''}
        </td></tr>
        <tr><td style="padding:14px 32px;border-top:1px solid #f3f4f6;background:#f9fafb;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">
            You're receiving this from Biddaro because you have an active account.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendOtpEmail(
  email: string,
  otp: string,
  firstName: string,
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY env var is not set');

  const senderEmail = process.env.FROM_EMAIL || 'noreply@biddaro.com';

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Biddaro', email: senderEmail },
      to: [{ email, name: firstName }],
      subject: `${otp} is your Biddaro verification code`,
      htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr>
            <td style="background:#ea580c;padding:24px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                Biddaro
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Verify your email address</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;">
                Hi ${firstName}, thanks for joining Biddaro! Enter the code below to activate your account.
              </p>
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
                This code expires in <strong>10 minutes</strong>.
              </p>
              <p style="margin:0;color:#6b7280;font-size:13px;">
                Never share this code with anyone. Biddaro will never ask for it.
              </p>
            </td>
          </tr>
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
</html>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API ${response.status}: ${body}`);
  }
}

// ─── Password Reset Email ──────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  resetLink: string,
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY env var is not set');

  const senderEmail = process.env.FROM_EMAIL || 'noreply@biddaro.com';

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Biddaro', email: senderEmail },
      to: [{ email, name: firstName }],
      subject: 'Reset your Biddaro password',
      htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr>
            <td style="background:#ea580c;padding:24px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                Biddaro
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Reset your password</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;">
                Hi ${firstName}, we received a request to reset your Biddaro password.
                Click the button below to choose a new one.
              </p>
              <div style="text-align:center;margin-bottom:24px;">
                <a href="${resetLink}"
                   style="display:inline-block;background:#ea580c;color:#ffffff;font-size:15px;
                          font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;">
                  Reset Password
                </a>
              </div>
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
                This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.
              </p>
              <p style="margin:0;color:#9ca3af;font-size:12px;word-break:break-all;">
                Or copy this link: ${resetLink}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #f3f4f6;background:#f9fafb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                Never share this link with anyone. Biddaro staff will never ask for it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API ${response.status}: ${body}`);
  }
}
// ─── Platform event emails ─────────────────────────────────────────────────────

/** 1. New bid on a job — notify the job poster */
export async function sendBidReceivedEmail(opts: {
  posterEmail: string; posterName: string;
  contractorName: string; jobTitle: string;
  bidAmount: number; jobId: string;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.posterEmail, name: opts.posterName }],
    subject: `New bid on your job: "${opts.jobTitle}"`,
    htmlContent: brandedHtml({
      preheader: `${opts.contractorName} submitted a bid of $${opts.bidAmount.toFixed(2)}`,
      bodyTitle: 'You received a new bid 📋',
      bodyLines: [
        `Hi ${opts.posterName},`,
        `<strong>${opts.contractorName}</strong> just submitted a bid of <strong>$${opts.bidAmount.toFixed(2)}</strong> on your job <strong>"${opts.jobTitle}"</strong>.`,
        'Review their proposal, portfolio and milestones, and accept the bid to create a contract.',
      ],
      ctaLink: `${FRONTEND()}/jobs/${opts.jobId}`,
      ctaLabel: 'Review Bid →',
      footerNote: "You're receiving this because you posted a job on Biddaro.",
    }),
  });
}

/** 2. Bid accepted — notify the contractor */
export async function sendBidAcceptedEmail(opts: {
  contractorEmail: string; contractorName: string;
  posterName: string; jobTitle: string;
  contractId: string; amount: number;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.contractorEmail, name: opts.contractorName }],
    subject: `Your bid was accepted — "${opts.jobTitle}"`,
    htmlContent: brandedHtml({
      preheader: `${opts.posterName} accepted your bid. A contract has been created.`,
      bodyTitle: 'Your bid was accepted! 🎉',
      bodyLines: [
        `Congratulations ${opts.contractorName}!`,
        `<strong>${opts.posterName}</strong> accepted your bid of <strong>$${opts.amount.toFixed(2)}</strong> for <strong>"${opts.jobTitle}"</strong>.`,
        'A contract has been created. The client will fund the escrow before work begins.',
      ],
      ctaLink: `${FRONTEND()}/contracts/${opts.contractId}`,
      ctaLabel: 'View Contract →',
    }),
  });
}

/** 3. Escrow funded — notify the contractor they can start work */
export async function sendEscrowFundedEmail(opts: {
  contractorEmail: string; contractorName: string;
  posterName: string; jobTitle: string;
  contractId: string; amount: number;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.contractorEmail, name: opts.contractorName }],
    subject: `Escrow funded — start work on "${opts.jobTitle}"`,
    htmlContent: brandedHtml({
      preheader: `$${opts.amount.toFixed(2)} is locked in escrow. You can begin work now.`,
      bodyTitle: "Escrow funded — you're cleared to start 🔒",
      bodyLines: [
        `Hi ${opts.contractorName},`,
        `<strong>${opts.posterName}</strong> has funded the escrow with <strong>$${opts.amount.toFixed(2)}</strong> for the contract on <strong>"${opts.jobTitle}"</strong>.`,
        'Your payment is now secured. Begin work and submit each milestone for review when complete.',
      ],
      ctaLink: `${FRONTEND()}/contracts/${opts.contractId}`,
      ctaLabel: 'View Contract →',
    }),
  });
}

/** 4. Milestone approved & payment released — notify the contractor */
export async function sendMilestoneApprovedEmail(opts: {
  contractorEmail: string; contractorName: string;
  jobTitle: string; contractId: string;
  milestoneTitle: string; payout: number; allDone: boolean;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.contractorEmail, name: opts.contractorName }],
    subject: opts.allDone
      ? `Contract complete — final payment released for "${opts.jobTitle}"`
      : `Payment released: "${opts.milestoneTitle}"`,
    htmlContent: brandedHtml({
      preheader: `$${opts.payout.toFixed(2)} has been released to your wallet.`,
      bodyTitle: opts.allDone ? 'Contract complete! All payments released 🎉' : 'Milestone payment released 💰',
      bodyLines: [
        `Hi ${opts.contractorName},`,
        opts.allDone
          ? `All milestones on <strong>"${opts.jobTitle}"</strong> have been approved. Your final payment of <strong>$${opts.payout.toFixed(2)}</strong> has been released.`
          : `Your milestone <strong>"${opts.milestoneTitle}"</strong> on <strong>"${opts.jobTitle}"</strong> was approved. <strong>$${opts.payout.toFixed(2)}</strong> has been added to your wallet.`,
        'The funds are now available in your Biddaro wallet.',
      ],
      ctaLink: `${FRONTEND()}/contracts/${opts.contractId}`,
      ctaLabel: opts.allDone ? 'View Completed Contract →' : 'View Contract →',
    }),
  });
}

/** 5. Dispute opened — notify the other party */
export async function sendDisputeOpenedEmail(opts: {
  recipientEmail: string; recipientName: string;
  raisedByName: string; jobTitle: string;
  contractId: string;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.recipientEmail, name: opts.recipientName }],
    subject: `A dispute has been raised on your contract — "${opts.jobTitle}"`,
    htmlContent: brandedHtml({
      preheader: `${opts.raisedByName} opened a dispute. Our team will review it.`,
      bodyTitle: 'A dispute has been raised ⚠️',
      bodyLines: [
        `Hi ${opts.recipientName},`,
        `<strong>${opts.raisedByName}</strong> has opened a dispute on the contract for <strong>"${opts.jobTitle}"</strong>.`,
        'All funds remain in escrow while the dispute is under review. Please log in to provide your evidence and response.',
      ],
      ctaLink: `${FRONTEND()}/contracts/${opts.contractId}`,
      ctaLabel: 'View Contract & Dispute →',
      footerNote: 'Biddaro dispute resolution protects both parties. Funds will not be released until resolved.',
    }),
  });
}

/** 6. Deposit approved — notify the user their bank transfer was credited */
export async function sendDepositApprovedEmail(opts: {
  recipientEmail: string; recipientName: string;
  amount: number; transactionId: string;
  adminNote?: string;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.recipientEmail, name: opts.recipientName }],
    subject: `Your deposit of $${opts.amount.toFixed(2)} has been approved`,
    htmlContent: brandedHtml({
      preheader: `$${opts.amount.toFixed(2)} has been added to your Biddaro wallet.`,
      bodyTitle: 'Deposit approved ✅',
      bodyLines: [
        `Hi ${opts.recipientName},`,
        `Your bank transfer deposit of <strong>$${opts.amount.toFixed(2)}</strong> (Ref: <code>${opts.transactionId}</code>) has been verified and credited to your Biddaro wallet.`,
        'The funds are available immediately. You can now post jobs, fund escrow, or use them for any Biddaro transaction.',
        ...(opts.adminNote ? [`Note from our team: ${opts.adminNote}`] : []),
      ],
      ctaLink: `${FRONTEND()}/wallet`,
      ctaLabel: 'View Wallet →',
    }),
  });
}

/** 7. Deposit rejected — notify the user their bank transfer was not approved */
export async function sendDepositRejectedEmail(opts: {
  recipientEmail: string; recipientName: string;
  amount: number; transactionId: string;
  adminNote?: string;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.recipientEmail, name: opts.recipientName }],
    subject: `Your deposit request could not be verified`,
    htmlContent: brandedHtml({
      preheader: 'Your deposit request was reviewed but could not be approved.',
      bodyTitle: 'Deposit request declined',
      bodyLines: [
        `Hi ${opts.recipientName},`,
        `We reviewed your deposit request of <strong>$${opts.amount.toFixed(2)}</strong> (Ref: <code>${opts.transactionId}</code>) but were unable to verify the bank transfer.`,
        ...(opts.adminNote
          ? [`Reason: ${opts.adminNote}`]
          : ['This can happen if the transaction ID or screenshot could not be matched. Please double-check and resubmit.']),
        'If you believe this is an error, please contact our support team with your proof of payment.',
      ],
      ctaLink: `${FRONTEND()}/wallet`,
      ctaLabel: 'Go to Wallet →',
      footerNote: 'No funds have been deducted from your bank account — this was a manual transfer review.',
    }),
  });
}

/** 8. New message received — email notification */
export async function sendNewMessageEmail(opts: {
  recipientEmail: string; recipientName: string;
  senderName: string;
}): Promise<void> {
  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.recipientEmail, name: opts.recipientName }],
    subject: `${opts.senderName} sent you a message on Biddaro`,
    htmlContent: brandedHtml({
      preheader: `You have a new message from ${opts.senderName}.`,
      bodyTitle: 'New message 💬',
      bodyLines: [
        `Hi ${opts.recipientName},`,
        `<strong>${opts.senderName}</strong> has sent you a message on Biddaro.`,
        'Log in to read and reply.',
      ],
      ctaLink: `${FRONTEND()}/messages`,
      ctaLabel: 'Read Message →',
      footerNote: 'You can manage your notification preferences in your account settings.',
    }),
  });
}

/** 9. Loan application status update */
export async function sendLoanStatusEmail(opts: {
  recipientEmail: string; recipientName: string;
  status: 'under_review' | 'approved' | 'rejected' | 'disbursed';
  amount: number; approvedAmount?: number; emiAmount?: number; adminNote?: string;
}): Promise<void> {
  const statusMap: Record<string, { emoji: string; title: string; preheader: string }> = {
    under_review: { emoji: '🔍', title: 'Your loan application is under review', preheader: 'Our team is reviewing your loan application.' },
    approved:     { emoji: '✅', title: 'Your loan application has been approved!', preheader: `Your loan of $${opts.approvedAmount?.toFixed(2) ?? opts.amount.toFixed(2)} has been approved.` },
    rejected:     { emoji: '❌', title: 'Your loan application was not approved', preheader: 'Your loan application could not be approved at this time.' },
    disbursed:    { emoji: '💸', title: 'Your loan has been disbursed!', preheader: `Funds have been transferred to your account.` },
  };
  const s = statusMap[opts.status] ?? statusMap['under_review'];

  const lines: string[] = [`Hi ${opts.recipientName},`];
  if (opts.status === 'approved' && opts.approvedAmount) {
    lines.push(`Great news! Your loan application for <strong>$${opts.amount.toFixed(2)}</strong> has been approved for <strong>$${opts.approvedAmount.toFixed(2)}</strong>.`);
    if (opts.emiAmount) lines.push(`Your estimated monthly EMI is <strong>$${opts.emiAmount.toFixed(2)}</strong>.`);
  } else if (opts.status === 'disbursed') {
    lines.push(`Your approved loan funds have been disbursed. Please check your registered bank account.`);
  } else if (opts.status === 'rejected') {
    lines.push(`We were unable to approve your loan application for <strong>$${opts.amount.toFixed(2)}</strong> at this time.`);
  } else {
    lines.push(`Your loan application for <strong>$${opts.amount.toFixed(2)}</strong> is currently under review by our team. We'll notify you once a decision is made.`);
  }
  if (opts.adminNote) lines.push(`Note: ${opts.adminNote}`);

  await brevoSend({
    sender: SENDER(),
    to: [{ email: opts.recipientEmail, name: opts.recipientName }],
    subject: `${s.emoji} ${s.title}`,
    htmlContent: brandedHtml({
      preheader: s.preheader,
      bodyTitle: `${s.emoji} ${s.title}`,
      bodyLines: lines,
      ctaLink: `${FRONTEND()}/my-loans`,
      ctaLabel: 'View Loan Application →',
    }),
  });
}
