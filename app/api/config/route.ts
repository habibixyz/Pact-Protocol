import { NextResponse } from "next/server";
import { isLiveMode } from "@/lib/blockchain";

export async function GET() {
  return NextResponse.json({
    liveMode: isLiveMode(),
    escrowAddress: process.env.NEXT_PUBLIC_A2A_ESCROW_ADDRESS || null,
    mockUSDCAddress: process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS || null,
  });
}
