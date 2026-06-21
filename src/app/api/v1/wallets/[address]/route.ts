export const dynamic = "force-dynamic";

import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    const wallet = await prisma.wallet.findUnique({
      where: { address },
      include: {
        entity: { select: { id: true, name: true, type: true, verified: true } },
        holdings: {
          include: { token: { select: { symbol: true, name: true, price: true, chain: true } } },
          orderBy: { usdValue: "desc" as const },
          take: 100,
        },
        transactions: {
          orderBy: { timestamp: "desc" as const },
          take: 50,
        },
      },
    });

    if (!wallet) {
      return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    }

    return NextResponse.json({ data: wallet });
  } catch (error) {
    console.error("GET /api/v1/wallets/[address] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
