export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/auth/resend-verification — Resend email verification.
// Issues a purpose-scoped JWT (purpose=email-verify, 1d TTL).
// Delivers via SMTP when configured (MAIL_* env); in development
// only, the verification link is returned in the response so the
// flow is testable without a mail server. Always returns 200 for a
// missing account to avoid user enumeration.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { signPurposeToken } from '@/lib/jwt';
import { checkRateLimit } from '@/lib/api/rate-limit';

const hasSmtp = Boolean(
  process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS
);

async function sendVerificationEmail(email: string, url: string): Promise<boolean> {
  if (!hasSmtp) return false;
  try {
    // nodemailer is an optional dependency — dynamic import keeps the app
    // bootable when it is not installed.
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT ?? 587),
      secure: process.env.MAIL_SECURE === 'true',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
    await transport.sendMail({
      from: process.env.MAIL_FROM ?? process.env.MAIL_USER,
      to: email,
      subject: 'Verify your email — Nexus Tracker',
      text: `Verify your Nexus Tracker email here:\n\n${url}\n\nThis link expires in 24 hours.`,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#e6edf3;background:#080b0f;border:1px solid #1e2328;border-radius:12px;"><div style="font-size:13px;letter-spacing:.3px;color:#5eead4;font-weight:700;margin-bottom:12px;">NEXUS</div><h1 style="font-size:20px;margin:0 0 12px;">Verify your email</h1><p style="font-size:14px;color:#9aa4b2;">Confirm this address to activate your NEXUS account.</p><p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#5eead4;color:#080b0f;font-weight:700;border-radius:8px;text-decoration:none;">Verify email</a></p><p style="font-size:12px;color:#6b7281;">This link expires in 24 hours. If the button does not work, paste this link:<br/><span style="word-break:break-all;">${url}</span></p></div>`,
    });
    return true;
  } catch (err) {
    console.error('Verification email send failed:', err);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 3 resends per 10 min per IP (email-bomb guard).
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : (request.headers.get('x-real-ip') ?? 'unknown');
    const { allowed } = await checkRateLimit(`auth:resend:${ip}`, 3, 600_000);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded, please try again later.' }, { status: 429 });
    }

    const { email } = (await request.json()) as { email?: string };
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Same generic response for every case (missing, already verified, unverified)
    // so callers cannot enumerate accounts or learn verification status.
    const responseBody: Record<string, string | boolean> = {
      message: 'If the account exists and is not yet verified, a verification email has been sent.',
    };

    // Only issue + deliver a link when the account exists and is unverified.
    if (user && !user.emailVerified) {
      const verifyToken = await signPurposeToken(
        { userId: user.id, email: user.email, role: user.role, plan: user.plan },
        'email-verify',
        '1d'
      );
      const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4400';
      const verifyUrl = `${base}/api/v1/auth/verify?token=${encodeURIComponent(verifyToken)}`;

      const sent = await sendVerificationEmail(user.email, verifyUrl);

      // Dev convenience only — never expose the verification link in production.
      if (!sent && process.env.NODE_ENV !== 'production') {
        responseBody.devLink = verifyUrl;
        responseBody.note = 'Development mode: SMTP not configured, verification link shown for testing.';
      }
    }

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('Resend verification error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
