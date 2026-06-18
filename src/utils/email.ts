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

/** Inspect: Send inspection report to client */
export async function sendInspectionReportEmail(opts: {
  clientEmail: string;
  clientName: string;
  inspectorName: string;
  reportTitle: string;
  projectName: string;
  projectLocation?: string;
  totalFindings: number;
  criticalCount: number;
  warningCount: number;
  overallStatus?: string;
  publicPortalUrl?: string;    // shareable link if enabled
  reportDate: string;
  pdfBuffer?: Buffer | null;   // optional PDF attachment
}): Promise<void> {
  const {
    clientEmail, clientName, inspectorName, reportTitle, projectName,
    projectLocation, totalFindings, criticalCount, warningCount,
    overallStatus, publicPortalUrl, reportDate, pdfBuffer,
  } = opts;

  const statusEmoji = overallStatus === 'pass' ? '✅' :
                      overallStatus === 'fail' ? '🔴' : '⚠️';

  const lines: string[] = [
    `Dear ${clientName},`,
    `Your inspection report <strong>"${reportTitle}"</strong> for <strong>${projectName}</strong>${projectLocation ? ` (${projectLocation})` : ''} has been completed and is ready for your review.`,
    `<strong>Date:</strong> ${reportDate}<br/><strong>Inspector:</strong> ${inspectorName}<br/><strong>Overall Status:</strong> ${statusEmoji} ${overallStatus ?? 'Reviewed'}`,
  ];

  if (totalFindings > 0) {
    const findingParts: string[] = [];
    if (criticalCount > 0) findingParts.push(`<span style="color:#dc2626;font-weight:600;">${criticalCount} critical</span>`);
    if (warningCount > 0) findingParts.push(`<span style="color:#d97706;font-weight:600;">${warningCount} warnings</span>`);
    const normalCount = totalFindings - criticalCount - warningCount;
    if (normalCount > 0) findingParts.push(`${normalCount} normal`);
    lines.push(`<strong>Findings Summary:</strong> ${findingParts.join(', ')} (${totalFindings} total)`);
  } else {
    lines.push('No issues were found during this inspection. All areas are in acceptable condition.');
  }

  if (publicPortalUrl) {
    lines.push(`You can view the full report, all sections, and detailed findings using the link below. No login is required.`);
  } else {
    lines.push(`Please contact your inspector to receive a copy of the detailed report.`);
  }

  // Brevo attachment: base64-encoded PDF (max ~25 MB via API)
  const attachments = pdfBuffer
    ? [{
        name: `${reportTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`,
        content: pdfBuffer.toString('base64'),
      }]
    : undefined;

  await brevoSend({
    sender: SENDER(),
    to: [{ email: clientEmail, name: clientName }],
    subject: `Inspection Report Ready — ${projectName}`,
    htmlContent: brandedHtml({
      preheader: `Your inspection report for ${projectName} is ready. ${totalFindings} finding${totalFindings !== 1 ? 's' : ''} identified.`,
      bodyTitle: `🏗️ Inspection Report Ready`,
      bodyLines: lines,
      ...(publicPortalUrl ? {
        ctaLink: publicPortalUrl,
        ctaLabel: 'View Full Report →',
      } : {}),
      footerNote: `This report was prepared by ${inspectorName} using Biddaro Inspect. Please keep this report for your records.`,
    }),
    ...(attachments ? { attachment: attachments } : {}),
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

/** 10. Inspect — share link sent to client when inspector enables public link */
export async function sendInspectShareLinkEmail(opts: {
  clientEmail: string;
  clientName: string;
  inspectorName: string;
  reportTitle: string;
  projectName: string;
  projectLocation?: string;
  publicPortalUrl: string;
}): Promise<void> {
  const { clientEmail, clientName, inspectorName, reportTitle, projectName, projectLocation, publicPortalUrl } = opts;
  await brevoSend({
    sender: SENDER(),
    to: [{ email: clientEmail, name: clientName }],
    subject: `Inspection Report Shared — ${projectName}`,
    htmlContent: brandedHtml({
      preheader: `${inspectorName} has shared an inspection report for ${projectName} with you.`,
      bodyTitle: '📋 Inspection Report Shared With You',
      bodyLines: [
        `Dear ${clientName},`,
        `<strong>${inspectorName}</strong> has shared an inspection report with you for <strong>${projectName}</strong>${projectLocation ? ` (${projectLocation})` : ''}.`,
        `Report: <strong>${reportTitle}</strong>`,
        `You can view the full report, all findings, and section details using the link below. No account or login is required.`,
        `If you have any questions about the findings, please contact your inspector directly.`,
      ],
      ctaLink: publicPortalUrl,
      ctaLabel: 'View Inspection Report →',
      footerNote: `This inspection report was prepared by ${inspectorName} using Biddaro Inspect.`,
    }),
  });
}

/** 11. Inspect — inspector notified when client signs the report */
export async function sendInspectSignatureNotificationEmail(opts: {
  inspectorEmail: string;
  inspectorName: string;
  clientSignedByName: string;
  reportTitle: string;
  projectName: string;
  signedAt: Date;
  reportUrl: string;
}): Promise<void> {
  const { inspectorEmail, inspectorName, clientSignedByName, reportTitle, projectName, signedAt, reportUrl } = opts;
  const dateStr = signedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = signedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  await brevoSend({
    sender: SENDER(),
    to: [{ email: inspectorEmail, name: inspectorName }],
    subject: `✅ Client Signed Inspection Report — ${projectName}`,
    htmlContent: brandedHtml({
      preheader: `${clientSignedByName} has digitally acknowledged the inspection report for ${projectName}.`,
      bodyTitle: '✅ Client Report Signature Received',
      bodyLines: [
        `Hi ${inspectorName},`,
        `Your client <strong>${clientSignedByName}</strong> has digitally acknowledged the inspection report for <strong>${projectName}</strong>.`,
        `<strong>Report:</strong> ${reportTitle}<br/><strong>Signed on:</strong> ${dateStr} at ${timeStr}`,
        `The signed acknowledgement will be included in all future PDF and DOCX exports of this report.`,
        `You can view the report and the client signature status in your Biddaro Inspect dashboard.`,
      ],
      ctaLink: reportUrl,
      ctaLabel: 'View Report in Dashboard →',
      footerNote: 'This notification was sent by Biddaro Inspect. The digital signature is stored securely.',
    }),
  });
}

export async function sendScheduleReminderEmail(opts: {
  toEmail: string;
  toName: string;
  scheduleTitle: string;
  projectName: string;
  projectLocation: string | null;
  scheduledAt: Date;
  notes: string | null;
  dashboardUrl: string;
}): Promise<void> {
  const { toEmail, toName, scheduleTitle, projectName, projectLocation, scheduledAt, notes, dashboardUrl } = opts;
  const dateStr = scheduledAt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = scheduledAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const location = projectLocation ? ` at ${projectLocation}` : '';
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: `🗓️ Reminder: Upcoming Inspection Tomorrow — ${projectName}`,
    htmlContent: brandedHtml({
      preheader: `Your inspection "${scheduleTitle}" for ${projectName} is scheduled for tomorrow.`,
      bodyTitle: '🗓️ Upcoming Inspection Reminder',
      bodyLines: [
        `Hi ${toName},`,
        `This is a reminder that the following inspection is coming up tomorrow:`,
        `<strong>${scheduleTitle}</strong><br/>Project: ${projectName}${location}<br/>Date & Time: ${dateStr}, ${timeStr}`,
        ...(notes ? [`<strong>Preparation Notes:</strong><br/>${notes}`] : []),
        `Make sure your inspection tools, checklists, and field capture app are ready.`,
        `Log in to your Biddaro Inspect dashboard to review the project details and previous reports before the visit.`,
      ],
      ctaLink: dashboardUrl,
      ctaLabel: 'View Project in Dashboard →',
      footerNote: 'This reminder was sent by Biddaro Inspect. To stop receiving reminders, remove the notification email from the schedule.',
    }),
  });
}

// ─── Loan Follow-Up Journey (4 stages) ────────────────────────────────────────

interface LoanFollowupOpts {
  toEmail:  string;
  toName:   string;
  loanType: string;
  amount?:  number | null;
  applyUrl: string;
  unsubUrl: string;
}

function loanFollowupFooter(unsubUrl: string): string {
  return `You received this because you started a loan application on Biddaro. <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe from loan reminders</a>`;
}

function loanTypeLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function fmtAmount(amount: number | null | undefined): string {
  if (!amount) return '';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

/** Stage 1 — 30 min after lead: warm nudge, details saved */
export async function sendLoanFollowupStage1(opts: LoanFollowupOpts): Promise<void> {
  const { toEmail, toName, loanType, applyUrl, unsubUrl } = opts;
  const loanLabel = loanTypeLabel(loanType);
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: `Your ${loanLabel} application is saved — finish in 2 minutes`,
    htmlContent: brandedHtml({
      preheader: `${toName}, your details are saved. Complete your loan application right now.`,
      bodyTitle: `You're One Step Away`,
      bodyLines: [
        `Hi ${toName},`,
        `You started a <strong>${loanLabel}</strong> application on Biddaro a few minutes ago — your details are saved and you're almost there.`,
        `<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:6px;margin:8px 0;">
           <p style="margin:0;font-size:14px;color:#166534;font-weight:600;">✅ Your application is ready to submit</p>
           <p style="margin:6px 0 0;font-size:13px;color:#166534;">Just complete the final step to get matched with lenders.</p>
         </div>`,
        `No documentation needed upfront. It takes less than 2 minutes — our advisors handle the rest.`,
      ],
      ctaLink:    applyUrl,
      ctaLabel:   'Complete My Application →',
      footerNote: loanFollowupFooter(unsubUrl),
    }),
  });
}

/** Stage 2 — 6h after capture: eligibility tease */
export async function sendLoanFollowupStage2(opts: LoanFollowupOpts): Promise<void> {
  const { toEmail, toName, loanType, applyUrl, unsubUrl } = opts;
  const loanLabel = loanTypeLabel(loanType);
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: `Good news, ${toName} — your profile looks eligible for a ${loanLabel} ✓`,
    htmlContent: brandedHtml({
      preheader: `Based on what you shared, you appear eligible. Complete your application to confirm.`,
      bodyTitle: `Your Profile Looks Eligible`,
      bodyLines: [
        `Hi ${toName},`,
        `We've reviewed the details you submitted and your profile looks eligible for a <strong>${loanLabel}</strong> through Biddaro's lending network.`,
        `<div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:6px;margin:8px 0;">
           <p style="margin:0;font-size:13px;color:#1e40af;font-weight:600;">Eligibility check: <span style="color:#16a34a;">Passed ✓</span></p>
           <p style="margin:4px 0 0;font-size:13px;color:#1e3a8a;">Next step: Complete your application to get a confirmed offer from our lenders.</p>
         </div>`,
        `<strong>What happens next:</strong><br/>
         ✅ Submit your application (2 minutes)<br/>
         ✅ Our team reviews within 24 hours<br/>
         ✅ Get matched with the best lender for your needs<br/>
         ✅ Funds disbursed directly to your account`,
        `Over <strong>10,000 contractors</strong> across India have used Biddaro to get their loans approved quickly.`,
      ],
      ctaLink:    applyUrl,
      ctaLabel:   'Confirm My Eligibility →',
      footerNote: loanFollowupFooter(unsubUrl),
    }),
  });
}

/** Stage 3 — 24h after capture: pre-approval check started */
export async function sendLoanFollowupStage3(opts: LoanFollowupOpts): Promise<void> {
  const { toEmail, toName, loanType, applyUrl, unsubUrl } = opts;
  const loanLabel = loanTypeLabel(loanType);
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: `Pre-approval check started for your ${loanLabel} — action needed`,
    htmlContent: brandedHtml({
      preheader: `Our team started processing your pre-approval. Complete the final step to proceed.`,
      bodyTitle: `Your Pre-Approval Check Has Started`,
      bodyLines: [
        `Hi ${toName},`,
        `Our loan advisors have started a pre-approval check for your <strong>${loanLabel}</strong> based on the details you submitted.`,
        `<div style="background:#fefce8;border-left:4px solid #ca8a04;padding:12px 16px;border-radius:6px;margin:8px 0;">
           <p style="margin:0;font-size:13px;color:#854d0e;font-weight:600;">⏳ Action required to complete pre-approval</p>
           <p style="margin:6px 0 0;font-size:13px;color:#713f12;">Your application is on hold until you complete the final step. This takes less than 2 minutes.</p>
         </div>`,
        `<strong>Why complete now?</strong><br/>
         🏦 Get matched with lenders offering the lowest rates<br/>
         ⚡ Decisions within 48 hours of submission<br/>
         🤝 A dedicated advisor handles your paperwork<br/>
         📋 No documents needed upfront`,
        `Don't let your pre-approval expire — complete your application now.`,
      ],
      ctaLink:    applyUrl,
      ctaLabel:   'Complete Pre-Approval →',
      footerNote: loanFollowupFooter(unsubUrl),
    }),
  });
}

/** Stage 4 — 2 days after capture: "pre-approved" high CTR hook */
export async function sendLoanFollowupStage4(opts: LoanFollowupOpts): Promise<void> {
  const { toEmail, toName, loanType, amount, applyUrl, unsubUrl } = opts;
  const loanLabel = loanTypeLabel(loanType);
  const amountStr = fmtAmount(amount);
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: `✅ Your ${loanLabel} has been pre-approved — claim it now`,
    htmlContent: brandedHtml({
      preheader: `${toName}, you've been pre-approved! Complete the last step to receive your loan offer.`,
      bodyTitle: `🎉 Congratulations — You're Pre-Approved!`,
      bodyLines: [
        `Hi ${toName},`,
        `Based on your profile and the details you submitted, you have been <strong>pre-approved</strong> for a ${loanLabel} on Biddaro's lending network.`,
        `<div style="background:#f0fdf4;border:2px solid #16a34a;padding:16px;border-radius:8px;margin:8px 0;text-align:center;">
           <p style="margin:0;font-size:13px;color:#166534;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Pre-Approved Loan</p>
           <p style="margin:8px 0 4px;font-size:22px;color:#111827;font-weight:700;">🏦 ${loanLabel}${amountStr ? ` — ${amountStr}` : ''}</p>
           <p style="margin:0;font-size:12px;color:#166534;">Reserved for ${toName} · Offer valid for 48 hours</p>
         </div>`,
        `<strong>To receive your loan offer:</strong><br/>
         1️⃣ Click the button below<br/>
         2️⃣ Complete the final payment step (takes 2 minutes)<br/>
         3️⃣ Our advisor contacts you within 24 hours with lender offers`,
        `<strong>⚠️ This pre-approved offer is reserved for you for 48 hours.</strong> After that, the slot may be given to another applicant.`,
      ],
      ctaLink:    applyUrl,
      ctaLabel:   'Claim My Pre-Approved Loan →',
      footerNote: loanFollowupFooter(unsubUrl),
    }),
  });
}

/** Stage 5 — 4 days after capture: personalized amount, urgency rising */
export async function sendLoanFollowupStage5(opts: LoanFollowupOpts): Promise<void> {
  const { toEmail, toName, loanType, amount, applyUrl, unsubUrl } = opts;
  const loanLabel = loanTypeLabel(loanType);
  const amountStr = fmtAmount(amount);
  const headline = amountStr
    ? `Your pre-approved ${amountStr} ${loanLabel} is still waiting`
    : `Your pre-approved ${loanLabel} is still waiting for you`;
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: amountStr
      ? `${toName}, your pre-approved ${amountStr} loan is waiting — don't lose it`
      : `${toName}, your pre-approved loan amount is waiting — claim it now`,
    htmlContent: brandedHtml({
      preheader: `You were pre-approved 2 days ago. Complete the last step before your offer expires.`,
      bodyTitle: headline,
      bodyLines: [
        `Hi ${toName},`,
        `Two days ago you were pre-approved for a <strong>${loanLabel}</strong>${amountStr ? ` of <strong>${amountStr}</strong>` : ''} on Biddaro — but the final step is still pending.`,
        `<div style="background:#fff7ed;border:2px solid #ea580c;padding:16px;border-radius:8px;margin:8px 0;">
           <p style="margin:0;font-size:13px;color:#9a3412;font-weight:700;">⚠️ Your offer is expiring soon</p>
           ${amountStr ? `<p style="margin:8px 0 4px;font-size:20px;color:#111827;font-weight:700;">${amountStr} ${loanLabel}</p>` : ''}
           <p style="margin:0;font-size:13px;color:#9a3412;">Complete the last step now to secure this offer before it expires.</p>
         </div>`,
        `<strong>Completing your application takes under 2 minutes.</strong> Our advisors are standing by to connect you with lenders as soon as you finish.`,
        `Don't let this offer slip away — hundreds of contractors across India are getting their loans approved on Biddaro every week.`,
      ],
      ctaLink:    applyUrl,
      ctaLabel:   'Secure My Loan Now →',
      footerNote: loanFollowupFooter(unsubUrl),
    }),
  });
}

/** Stage 6 — 6 days after capture: urgent 48h countdown */
export async function sendLoanFollowupStage6(opts: LoanFollowupOpts): Promise<void> {
  const { toEmail, toName, loanType, amount, applyUrl, unsubUrl } = opts;
  const loanLabel = loanTypeLabel(loanType);
  const amountStr = fmtAmount(amount);
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: `⏰ URGENT: Your pre-approved ${loanLabel} expires in 48 hours`,
    htmlContent: brandedHtml({
      preheader: `${toName}, your pre-approved loan offer closes in 48 hours. Act now before it's too late.`,
      bodyTitle: `⏰ 48 Hours Left — Your Offer Expires Soon`,
      bodyLines: [
        `Hi ${toName},`,
        `Your pre-approved <strong>${loanLabel}</strong>${amountStr ? ` of <strong>${amountStr}</strong>` : ''} on Biddaro expires in <strong>48 hours</strong>.`,
        `<div style="background:#fef2f2;border:2px solid #dc2626;padding:16px;border-radius:8px;margin:8px 0;text-align:center;">
           <p style="margin:0;font-size:28px;font-weight:700;color:#dc2626;">48:00:00</p>
           <p style="margin:4px 0 0;font-size:13px;color:#991b1b;font-weight:600;">Hours remaining on your pre-approved offer</p>
           ${amountStr ? `<p style="margin:8px 0 0;font-size:16px;color:#111827;font-weight:700;">${amountStr} ${loanLabel}</p>` : ''}
         </div>`,
        `After this deadline, your pre-approved slot will be released and we cannot guarantee this offer will be available again.`,
        `<strong>This is the fastest path to your loan:</strong><br/>
         ✅ Complete the last step (2 minutes)<br/>
         ✅ Advisor calls you within 24 hours<br/>
         ✅ Funds in your account within days`,
      ],
      ctaLink:    applyUrl,
      ctaLabel:   'Complete Now Before Offer Expires →',
      footerNote: loanFollowupFooter(unsubUrl),
    }),
  });
}

/** Stage 7 — 7 days after capture: final last-chance email */
export async function sendLoanFollowupStage7(opts: LoanFollowupOpts): Promise<void> {
  const { toEmail, toName, loanType, amount, applyUrl, unsubUrl } = opts;
  const loanLabel = loanTypeLabel(loanType);
  const amountStr = fmtAmount(amount);
  await brevoSend({
    sender: SENDER(),
    to: [{ email: toEmail, name: toName }],
    subject: `🔴 Last chance: Your ${loanLabel} offer closes tonight`,
    htmlContent: brandedHtml({
      preheader: `This is our final message. Your pre-approved loan offer expires today — complete it now or lose it.`,
      bodyTitle: `🔴 Final Notice — Offer Closes Today`,
      bodyLines: [
        `Hi ${toName},`,
        `This is our last message regarding your pre-approved <strong>${loanLabel}</strong>${amountStr ? ` of <strong>${amountStr}</strong>` : ''}.`,
        `<div style="background:#1f2937;padding:20px;border-radius:8px;margin:8px 0;text-align:center;">
           <p style="margin:0;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Pre-Approved Offer for ${toName}</p>
           ${amountStr ? `<p style="margin:8px 0 4px;font-size:24px;color:#ffffff;font-weight:700;">${amountStr}</p>` : ''}
           <p style="margin:4px 0 0;font-size:14px;color:#f97316;font-weight:600;">${loanLabel} · Expires Tonight</p>
         </div>`,
        `After today, we will close your application and release the slot to other applicants. We will not be able to reinstate this offer.`,
        `If you've been meaning to complete this — <strong>now is the moment.</strong> It takes 2 minutes and our advisors will take care of everything else.`,
      ],
      ctaLink:    applyUrl,
      ctaLabel:   'Complete My Application — Last Chance →',
      footerNote: loanFollowupFooter(unsubUrl),
    }),
  });
}
