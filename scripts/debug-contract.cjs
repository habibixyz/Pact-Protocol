const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const escrowAddress = process.env.NEXT_PUBLIC_A2A_ESCROW_ADDRESS;
  const usdcAddress = process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS;

  console.log("Escrow Address:", escrowAddress);
  console.log("USDC Address:", usdcAddress);

  const abi = [
    "function owner() view returns (address)",
    "function paymentToken() view returns (address)",
    "function jobCount() view returns (uint256)",
    "function getRegisteredAgents() view returns (address[])",
    "function jobs(uint256) view returns (uint256 id, address buyer, address worker, uint256 budget, uint256 expectedLatency, uint256 startTime, uint256 resolutionTime, uint256 elapsedTime, uint256 payoutWorker, uint256 refundBuyer, uint8 status, string resultHash)"
  ];

  const escrow = new ethers.Contract(escrowAddress, abi, provider);

  const owner = await escrow.owner();
  const paymentToken = await escrow.paymentToken();
  const jobCount = await escrow.jobCount();
  const agents = await escrow.getRegisteredAgents();

  console.log("On-chain Owner:", owner);
  console.log("On-chain Payment Token (USDC):", paymentToken);
  console.log("On-chain Job Count:", jobCount.toString());
  console.log("On-chain Registered Agents:", agents);

  if (Number(jobCount) > 0) {
    for (let i = 1; i <= Number(jobCount); i++) {
      const job = await escrow.jobs(i);
      console.log(`Job #${i}:`, {
        id: job[0].toString(),
        buyer: job[1],
        worker: job[2],
        budget: ethers.formatUnits(job[3], 6),
        expectedLatency: job[4].toString(),
        status: job[10].toString(),
        resultHash: job[11]
      });
    }
  }
}

main().catch(console.error);
