export const runtime = 'nodejs';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/auth/forgot — Request a password reset link.
// Issues a short-lived, purpose-scoped JWT (purpose=password-reset,
// 30m TTL). Delivers via SMTP when configured (MAIL_* env); in
// development only, the reset link is returned in the response so the
// flow is testable without a mail server. In production the link is
// NEVER returned in the response — only emailed.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { signPurposeToken } from '@/lib/jwt';

const forgotSchema = z.object({
  email: z.string().email('Invalid email address'),
});

const hasSmtp = Boolean(
  process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS
);

async function sendResetEmail(email: string, url: string): Promise<boolean> {
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
      subject: 'Nexus — Reset your password',
      text: `Reset your Nexus password here:\n\n${url}\n\nThis link expires in 30 minutes.`,
      html: `<p>Reset your Nexus password:</p><p><a href="${url}">${url}</a></p><p>This link expires in 30 minutes.</p>`,
    });
    return true;
  } catch (err) {
    console.error('Password reset email send failed:', err);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = forgotSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    const { email } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    // Always return 200 (even when the user does not exist) to avoid
    // account enumeration.
    if (!user) {
      return NextResponse.json({ message: 'If that email exists, a reset link was sent.' }, { status: 200 });
    }

    // Purpose-scoped, short-lived token — cannot be reused as a session
    // token or for any other flow.
    const token = await signPurposeToken(
      { userId: user.id, email: user.email, role: user.role, plan: user.plan },
      'password-reset',
      '30m'
    );

    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:4400';
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;

    const sent = await sendResetEmail(email, resetUrl);

    const responseBody: Record<string, string> = {
      message: 'If that email exists, a reset link was sent.',
    };
    // Dev convenience only — never expose the reset link in production.
    if (!sent && process.env.NODE_ENV !== 'production') {
      responseBody.devLink = resetUrl;
      responseBody.note = 'Development mode: SMTP not configured, reset link shown for testing.';
    }

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}