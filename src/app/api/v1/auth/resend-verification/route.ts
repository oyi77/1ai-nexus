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
      html: `<p>Click <a href="${url}">here</a> to verify your email.</p><p>This link expires in 24 hours.</p>`,
    });
    return true;
  } catch (err) {
    console.error('Verification email send failed:', err);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
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
