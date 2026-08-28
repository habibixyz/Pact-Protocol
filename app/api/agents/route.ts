import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { isLiveMode, getProvider, getSigner, getEscrowContract } from "@/lib/blockchain";

// Server-side in-memory storage for custom agents (fallback when in Mock Mode)
interface AgentItem {
  id: string;
  name: string;
  address: string;
  endpoint: string;
  pricePerUnit: number;
  expectedLatency: number;
  reputation: number;
}

const customAgentsMemory: AgentItem[] = [];

const DEFAULT_AGENTS: AgentItem[] = [
  {
    id: "catalog-auditor",
    name: "B2B Catalog Auditor Agent",
    address: "0x8F3Cf7ad23Cd3Cadca9b8B9787c800a291AfE7a7",
    endpoint: "/api/v1/agents/catalog-audit",
    pricePerUnit: 0.2,
    expectedLatency: 30,
    reputation: 99.4,
  },
  {
    id: "translator",
    name: "L10n Translation Agent",
    address: "0x7A4fF3aD23Cd3Cadca9b8B9787c800a291AfE2b8",
    endpoint: "/api/v1/agents/translate",
    pricePerUnit: 0.05,
    expectedLatency: 30,
    reputation: 98.9,
  },
  {
    id: "sentiment",
    name: "Market Sentiment Agent",
    address: "0x6B2eE3aD23Cd3Cadca9b8B9787c800a291AfE3c9",
    endpoint: "/api/v1/agents/sentiment",
    pricePerUnit: 1.0,
    expectedLatency: 15,
    reputation: 92.1,
  },
];

export async function GET() {
  try {
    const agentsList = [...DEFAULT_AGENTS];

    if (isLiveMode()) {
      try {
        console.log("Fetching registered agents from Base Sepolia...");
        const provider = getProvider();
        const escrow = getEscrowContract(provider);
        
        // 1. Get all registered wallet addresses on-chain
        const addresses: string[] = await escrow.getRegisteredAgents();
        
        // 2. Fetch registry details for each address
        const onChainAgents: AgentItem[] = [];
        for (const addr of addresses) {
          // If it matches one of our default agents, skip adding it twice
          if (agentsList.some(a => a.address.toLowerCase() === addr.toLowerCase())) {
            continue;
          }
          
          const reg = await escrow.registry(addr);
          if (reg && reg.isRegistered) {
            onChainAgents.push({
              id: `onchain-${addr.substring(2, 8).toLowerCase()}`,
              name: reg.name,
              address: reg.wallet,
              endpoint: reg.endpoint,
              pricePerUnit: parseFloat(ethers.formatUnits(reg.pricePerUnit, 6)), // MockUSDC has 6 decimals
              expectedLatency: Number(reg.expectedLatency),
              reputation: 95.0, // Default reputation for custom agents
            });
          }
        }
        
        return NextResponse.json({
          success: true,
          liveMode: true,
          agents: [...agentsList, ...onChainAgents],
        });
      } catch (blockchainError: any) {
        console.error("Failed to fetch from blockchain, falling back to local memory:", blockchainError.message);
      }
    }

    // Mock Mode Fallback: Merge default list with local memory custom agents
    return NextResponse.json({
      success: true,
      liveMode: false,
      agents: [...agentsList, ...customAgentsMemory],
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || "Failed to load agent catalog",
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { name, endpoint, pricePerUnit, expectedLatency, walletAddress } = body;

    if (!name || !endpoint || !pricePerUnit || !expectedLatency) {
      return NextResponse.json({
        success: false,
        error: "Missing required fields: name, endpoint, pricePerUnit, expectedLatency",
      }, { status: 400 });
    }

    const priceNum = parseFloat(pricePerUnit);
    const latencyNum = parseInt(expectedLatency);
    
    // Assign a wallet address (use provided or generate mock)
    const agentWallet = walletAddress || "0x" + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    if (isLiveMode()) {
      try {
        console.log("Registering custom agent on Base Sepolia server-side...");
        const signer = getSigner();
        const escrow = getEscrowContract(signer);

        const tx = await escrow.registerAgent(
          name,
          endpoint,
          ethers.parseUnits(priceNum.toString(), 6), // MockUSDC decimals
          latencyNum
        );
        const receipt = await tx.wait();
        console.log(`Agent registered on-chain. Tx: ${receipt.hash}`);

        return NextResponse.json({
          success: true,
          liveMode: true,
          txHash: receipt.hash,
          agent: {
            id: `onchain-${signer.address.substring(2, 8).toLowerCase()}`,
            name,
            address: signer.address,
            endpoint,
            pricePerUnit: priceNum,
            expectedLatency: latencyNum,
            reputation: 95.0,
          }
        });
      } catch (blockchainError: any) {
        console.error("Failed to register on Base Sepolia on-chain:", blockchainError.message);
        return NextResponse.json({
          success: false,
          error: `Blockchain error: ${blockchainError.message}`,
        }, { status: 500 });
      }
    }

    // Mock Mode: Store in local memory
    const newAgent: AgentItem = {
      id: `custom-${Date.now().toString(36)}`,
      name,
      address: agentWallet,
      endpoint,
      pricePerUnit: priceNum,
      expectedLatency: latencyNum,
      reputation: 95.0,
    };

    customAgentsMemory.push(newAgent);

    return NextResponse.json({
      success: true,
      liveMode: false,
      agent: newAgent,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || "Failed to register custom agent",
    }, { status: 500 });
  }
}
