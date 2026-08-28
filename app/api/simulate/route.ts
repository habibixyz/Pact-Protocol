import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { isLiveMode, getSigner, getUSDCContract, getEscrowContract } from "@/lib/blockchain";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { 
      mode = "success", 
      agentId = "catalog-auditor",
      agentName,
      agentAddress,
      expectedLatency: reqExpectedLatency,
      budget: reqBudget
    } = body;

    // Simulate Agent Profiles (Default Fallbacks)
    const defaultAgents: Record<string, { name: string; address: string; endpoint: string }> = {
      "catalog-auditor": {
        name: "B2B Catalog Auditor Agent",
        address: "0x8F3Cf7ad23Cd3Cadca9b8B9787c800a291AfE7a7",
        endpoint: "/api/v1/agents/catalog-audit",
      },
      "translator": {
        name: "L10n Translation Agent",
        address: "0x7A4fF3aD23Cd3Cadca9b8B9787c800a291AfE2b8",
        endpoint: "/api/v1/agents/translate",
      },
      "sentiment": {
        name: "Market Sentiment Agent",
        address: "0x6B2eE3aD23Cd3Cadca9b8B9787c800a291AfE3c9",
        endpoint: "/api/v1/agents/sentiment",
      },
    };

    // Determine target agent details dynamically
    const targetAgent = {
      name: agentName || (defaultAgents[agentId] ? defaultAgents[agentId].name : "Custom AI Agent"),
      address: agentAddress || (defaultAgents[agentId] ? defaultAgents[agentId].address : "0x" + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")),
      endpoint: body.endpoint || (defaultAgents[agentId] ? defaultAgents[agentId].endpoint : "/api/v1/agents/custom")
    };

    // Determine latency SLA and budget
    const expectedLatency = reqExpectedLatency ? Number(reqExpectedLatency) : (agentId === "sentiment" ? 15 : 30);
    const budget = reqBudget ? Number(reqBudget) : 100.0;
    const penaltyRateBps = 100; // 1% (100 bps) per second of delay
    const bpsDenominator = 10000;

    // Generate random mock transaction hashes as backup fallback
    const mockApproveTx = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const mockCreateJobTx = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const mockResolveTx = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    // Simulate execution time based on mode and expected SLA latency
    let elapsedTime = 0;
    if (mode === "success") {
      // safe within SLA (around 40% to 80% of expected latency)
      elapsedTime = parseFloat((expectedLatency * 0.4 + Math.random() * (expectedLatency * 0.4)).toFixed(2));
    } else {
      // violates SLA (around 1.2x to 1.7x of expected latency)
      elapsedTime = parseFloat((expectedLatency * 1.2 + Math.random() * (expectedLatency * 0.5)).toFixed(2));
    }

    // Check if Live Blockchain Mode is enabled in env variables
    if (isLiveMode()) {
      try {
        console.log("Base Sepolia Live Mode active. Connecting to chain...");
        const signer = getSigner();
        const buyerAddress = signer.address;
        const escrowAddress = process.env.NEXT_PUBLIC_A2A_ESCROW_ADDRESS!;

        const usdc = getUSDCContract(signer);
        const escrow = getEscrowContract(signer);

        // 1. Ensure Worker Agent is registered in the contract registry
        const registryInfo = await escrow.registry(targetAgent.address);
        let regTxHash = "";
        if (!registryInfo.isRegistered) {
          console.log(`Registering custom simulation agent ${targetAgent.name} on Base Sepolia...`);
          const regTx = await escrow.registerAgent(
            targetAgent.name,
            targetAgent.endpoint,
            ethers.parseUnits("100.0", 6), // 100 USDC standard price
            expectedLatency
          );
          const regReceipt = await regTx.wait();
          regTxHash = regReceipt.hash;
          console.log(`Agent registered on-chain. Tx: ${regTxHash}`);
        }

        // 2. Check USDC balance, mint if necessary
        const decimals = await usdc.decimals();
        const budgetRaw = ethers.parseUnits(budget.toString(), decimals);
        const balance = await usdc.balanceOf(buyerAddress);

        if (balance < budgetRaw) {
          console.log("Insufficient USDC balance. Minting test MockUSDC...");
          const mintTx = await usdc.mint(buyerAddress, ethers.parseUnits("500.0", decimals));
          await mintTx.wait();
        }

        // 3. Approve A2AEscrow to spend USDC
        console.log("Checking token allowance...");
        const currentAllowance = await usdc.allowance(buyerAddress, escrowAddress);
        let approveTxHash = mockApproveTx;
        
        if (currentAllowance < budgetRaw) {
          console.log("Approving A2AEscrow...");
          const approveTx = await usdc.approve(escrowAddress, ethers.parseUnits("10000.0", decimals));
          const approveReceipt = await approveTx.wait();
          approveTxHash = approveReceipt.hash;
          console.log(`USDC approved. Tx: ${approveTxHash}`);
        } else {
          console.log("Sufficient allowance already exists.");
        }

        // 4. Create Job (using targetAgent.address as the worker agent)
        console.log(`Creating Job on-chain. Worker: ${targetAgent.address}...`);
        const createTx = await escrow.createJob(targetAgent.address, budgetRaw, expectedLatency);
        const createReceipt = await createTx.wait();
        const createTxHash = createReceipt.hash;
        console.log(`Job created. Tx: ${createTxHash}`);

        // Get the job ID (parsed from the JobCreated event logs)
        let jobId = 0;
        if (createReceipt && createReceipt.logs) {
          for (const log of createReceipt.logs) {
            try {
              const parsedLog = escrow.interface.parseLog({
                topics: log.topics as string[],
                data: log.data
              });
              if (parsedLog && parsedLog.name === "JobCreated") {
                jobId = Number(parsedLog.args.jobId);
                console.log(`Parsed Job ID from transaction logs: ${jobId}`);
                break;
              }
            } catch {
              // Ignore logs from other contracts
            }
          }
        }

        if (jobId === 0) {
          const rawJobCount = await escrow.jobCount();
          jobId = Number(rawJobCount);
          console.log(`Fallback to jobCount() returned Job ID: ${jobId}`);
        }

        // 5. Resolve Job (owner resolves it on behalf of custom agent)
        console.log(`Resolving Job #${jobId} on-chain with elapsed time of ${elapsedTime}s...`);
        const elapsedRounded = Math.ceil(elapsedTime);
        const resolveTx = await escrow.resolveJob(jobId, elapsedRounded, "ipfs://QmSimulationResultHash", {
          gasLimit: 250000
        });
        const resolveReceipt = await resolveTx.wait();
        const resolveTxHash = resolveReceipt.hash;
        console.log(`Job resolved. Tx: ${resolveTxHash}`);

        // 6. Parse resolution values directly from the transaction events
        let payoutWorker = 0;
        let refundBuyer = 0;
        let status = "Completed";

        if (resolveReceipt && resolveReceipt.logs) {
          for (const log of resolveReceipt.logs) {
            try {
              const parsedLog = escrow.interface.parseLog({
                topics: log.topics as string[],
                data: log.data
              });
              if (parsedLog && parsedLog.name === "JobResolved") {
                payoutWorker = parseFloat(ethers.formatUnits(parsedLog.args.payoutWorker, decimals));
                refundBuyer = parseFloat(ethers.formatUnits(parsedLog.args.refundBuyer, decimals));
                const statusMap = ["Active", "Completed", "Slashed", "Refunded"];
                status = statusMap[Number(parsedLog.args.status)] || "Completed";
                console.log(`Parsed JobResolved on-chain event: payoutWorker=${payoutWorker}, refundBuyer=${refundBuyer}, status=${status}`);
                break;
              }
            } catch {
              // Ignore logs from other contracts
            }
          }
        }

        // Fallback in case log parsing failed
        if (payoutWorker === 0 && refundBuyer === 0 && status === "Completed") {
          try {
            const job = await escrow.jobs(jobId);
            payoutWorker = parseFloat(ethers.formatUnits(job.payoutWorker, decimals));
            refundBuyer = parseFloat(ethers.formatUnits(job.refundBuyer, decimals));
            const statusMap = ["Active", "Completed", "Slashed", "Refunded"];
            status = statusMap[Number(job.status)] || "Completed";
          } catch {
            // Keep default fallback values
          }
        }

        const provider = signer.provider;
        const currentBlock = provider ? await provider.getBlockNumber() : 0;

        const events = [
          {
            step: "approve",
            message: "ERC20 Approval Sent",
            txHash: approveTxHash,
            timestamp: new Date(Date.now() - 10000).toISOString(),
            details: `Approved A2AEscrow contract (${escrowAddress}) to spend ${budget} USDC from ${buyerAddress}`,
          },
          {
            step: "create",
            message: "Job Escrow Locked (JobCreated Event)",
            txHash: createTxHash,
            timestamp: new Date(Date.now() - 5000).toISOString(),
            details: `Job #${jobId} locked. Worker: ${targetAgent.name} (${targetAgent.address}). SLA Latency: ${expectedLatency}s. Budget: ${budget} USDC`,
          },
          {
            step: "resolve",
            message: `Job Resolved on Base Sepolia (JobResolved Event) - Status: ${status}`,
            txHash: resolveTxHash,
            timestamp: new Date().toISOString(),
            details: `Elapsed Time: ${elapsedTime}s. SLA Expected: ${expectedLatency}s. Payout to Worker: ${payoutWorker} USDC. Refund to Buyer: ${refundBuyer} USDC. Block: ${currentBlock}`,
          },
        ];

        return NextResponse.json({
          success: true,
          liveMode: true,
          jobId,
          mode,
          agent: targetAgent,
          buyerAddress,
          budget,
          expectedLatency,
          elapsedTime,
          payoutWorker,
          refundBuyer,
          status,
          events,
        });
      } catch (blockchainError: unknown) {
        console.error("Blockchain execution failed, falling back to mock simulation:", 
          blockchainError instanceof Error ? blockchainError.message : String(blockchainError)
        );
      }
    }

    // Default Fallback Mode (Mock Simulation)
    const buyerAddress = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4"; // Mock Buyer Agent
    let payoutWorker = budget;
    let refundBuyer = 0.0;
    let status = "Completed";

    if (elapsedTime > expectedLatency) {
      const delaySeconds = Math.max(0, Math.ceil(elapsedTime - expectedLatency));
      const penaltyBps = delaySeconds * penaltyRateBps;

      if (penaltyBps >= bpsDenominator) {
        payoutWorker = 0.0;
        refundBuyer = budget;
        status = "Refunded";
      } else {
        refundBuyer = parseFloat(((budget * penaltyBps) / bpsDenominator).toFixed(2));
        payoutWorker = parseFloat((budget - refundBuyer).toFixed(2));
        status = "Slashed";
      }
    }

    const events = [
      {
        step: "approve",
        message: "ERC20 Approval Sent (Mock)",
        txHash: mockApproveTx,
        timestamp: new Date(Date.now() - 30000).toISOString(),
        details: `Approved A2AEscrow contract to spend ${budget} USDC from ${buyerAddress}`,
      },
      {
        step: "create",
        message: "Job Escrow Locked (JobCreated Event - Mock)",
        txHash: mockCreateJobTx,
        timestamp: new Date(Date.now() - 25000).toISOString(),
        details: `Job #402 locked. Worker: ${targetAgent.name} (${targetAgent.address}). SLA Latency: ${expectedLatency}s. Budget: ${budget} USDC`,
      },
      {
        step: "resolve",
        message: `Job Resolved (JobResolved Event - Mock) - Status: ${status}`,
        txHash: mockResolveTx,
        timestamp: new Date().toISOString(),
        details: `Elapsed Time: ${elapsedTime}s. SLA Expected: ${expectedLatency}s. Payout to Worker: ${payoutWorker} USDC. Refund to Buyer: ${refundBuyer} USDC`,
      },
    ];

    return NextResponse.json({
      success: true,
      liveMode: false,
      jobId: 402,
      mode,
      agent: targetAgent,
      buyerAddress,
      budget,
      expectedLatency,
      elapsedTime,
      payoutWorker,
      refundBuyer,
      status,
      events,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Simulation execution failed";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
