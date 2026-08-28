const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const signer = new ethers.Wallet(privateKey, provider);

  const escrowAddress = process.env.NEXT_PUBLIC_A2A_ESCROW_ADDRESS;
  const abi = [
    "function resolveJob(uint256 jobId, uint256 elapsedTime, string memory resultHash)",
    "function jobs(uint256) view returns (uint256 id, address buyer, address worker, uint256 budget, uint256 expectedLatency, uint256 startTime, uint256 resolutionTime, uint256 elapsedTime, uint256 payoutWorker, uint256 refundBuyer, uint8 status, string resultHash)"
  ];

  const escrow = new ethers.Contract(escrowAddress, abi, signer);

  console.log("Simulating/Calling resolveJob(2, 22, 'ipfs://...') from address:", signer.address);
  
  try {
    const job = await escrow.jobs(2);
    console.log("Job #2 state:", {
      id: job[0].toString(),
      buyer: job[1],
      worker: job[2],
      budget: ethers.formatUnits(job[3], 6),
      expectedLatency: job[4].toString(),
      status: job[10].toString()
    });

    const tx = await escrow.resolveJob(2, 22, "ipfs://QmSimulationResultHash");
    console.log("Tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("Tx receipt status:", receipt.status);
  } catch (error) {
    console.error("Revert error details:", error);
  }
}

main().catch(console.error);
