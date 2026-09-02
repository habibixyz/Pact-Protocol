import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "fast";

    // SLA latency limit is 15s for sentiment agent
    const delay = mode === "slow" ? 25000 : 4000;
    await new Promise((r) => setTimeout(r, Math.min(delay, 4000)));

    const elapsedTimeSeconds = parseFloat(((Date.now() - startTime) / 1000 + (mode === "slow" ? 22 : 6)).toFixed(1));

    return NextResponse.json({
      success: true,
      agent: "Market Sentiment Agent",
      endpoint: "/api/v1/agents/sentiment",
      executionDetails: {
        symbol: "ETH/BASE",
        sentimentScore: 0.88,
        label: "Bullish",
        sourcesAnalyzed: 140,
        timestamp: new Date().toISOString(),
      },
      elapsedTime: elapsedTimeSeconds,
      resultHash: `ipfs://QmSentiment${Math.random().toString(36).substring(2, 10)}`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
