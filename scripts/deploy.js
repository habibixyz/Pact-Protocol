import hre from "hardhat";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  console.log("====================================================");
  console.log("Deploying contracts to Base network...");
  console.log("Deployer Address:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer ETH Balance:", ethers.formatEther(balance), "ETH");
  console.log("====================================================");

  const networkName = hardhatNetworkName();
  let mockUSDCAddress = "";

  if (networkName === "base-mainnet") {
    // Official USDC address on Base Mainnet
    mockUSDCAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    console.log("Using Official USDC address on Base Mainnet:", mockUSDCAddress);
  } else {
    // 1. Deploy MockUSDC on testnet/local
    console.log("Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    mockUSDCAddress = await mockUSDC.getAddress();
    console.log("MockUSDC deployed to:", mockUSDCAddress);
  }

  // 2. Deploy A2AEscrow passing USDC address to constructor
  console.log("Deploying A2AEscrow...");
  const A2AEscrow = await ethers.getContractFactory("A2AEscrow");
  const a2aEscrow = await A2AEscrow.deploy(mockUSDCAddress);
  await a2aEscrow.waitForDeployment();
  const escrowAddress = await a2aEscrow.getAddress();
  console.log("A2AEscrow deployed to:", escrowAddress);
  console.log("====================================================");

  // 3. Output verification commands
  console.log("\nDeployment completed successfully!");
  console.log("To verify the contracts on Basescan, run the following commands:");
  console.log("----------------------------------------------------------------");
  if (networkName === "base-mainnet") {
    console.log(`npx hardhat verify --network ${networkName} ${escrowAddress} ${mockUSDCAddress}`);
  } else {
    console.log(`npx hardhat verify --network ${networkName} ${mockUSDCAddress}`);
    console.log(`npx hardhat verify --network ${networkName} ${escrowAddress} ${mockUSDCAddress}`);
  }
  console.log("----------------------------------------------------------------\n");
}

function hardhatNetworkName() {
  const network = process.argv.indexOf("--network");
  if (network !== -1 && network + 1 < process.argv.length) {
    return process.argv[network + 1];
  }
  return "base-sepolia";
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed with error:", error);
    process.exit(1);
  });
