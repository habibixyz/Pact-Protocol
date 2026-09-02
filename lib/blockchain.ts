import { ethers } from "ethers";

export const BASE_SEPOLIA_CHAIN_ID = "0x14a34"; // 84532 in Hex

// Minimal ABIs to interact with the contracts from Next.js (server and client side)
export const MOCK_USDC_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

export const A2A_ESCROW_ABI = [
  "function owner() view returns (address)",
  "function paymentToken() view returns (address)",
  "function jobCount() view returns (uint256)",
  "function jobs(uint256) view returns (uint256 id, address buyer, address worker, uint256 budget, uint256 expectedLatency, uint256 startTime, uint256 resolutionTime, uint256 elapsedTime, uint256 payoutWorker, uint256 refundBuyer, uint8 status, string resultHash)",
  "function registry(address) view returns (address wallet, string name, string endpoint, uint256 pricePerUnit, uint256 expectedLatency, bool isRegistered)",
  "function getRegisteredAgents() view returns (address[])",
  "function registerAgent(string name, string endpoint, uint256 pricePerUnit, uint256 expectedLatency)",
  "function createJob(address worker, uint256 budget, uint256 expectedLatency) returns (uint256)",
  "function resolveJob(uint256 jobId, uint256 elapsedTime, string resultHash)",
  "event AgentRegistered(address indexed wallet, string name, string endpoint, uint256 pricePerUnit, uint256 expectedLatency)",
  "event JobCreated(uint256 indexed jobId, address indexed buyer, address indexed worker, uint256 budget, uint256 expectedLatency)",
  "event JobResolved(uint256 indexed jobId, uint256 payoutWorker, uint256 refundBuyer, uint256 elapsedTime, uint8 status)"
];

// Helper to check if blockchain configuration is present
export const isLiveMode = (): boolean => {
  const hasUSDC = !!process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS;
  const hasEscrow = !!process.env.NEXT_PUBLIC_A2A_ESCROW_ADDRESS;
  const hasRpc = !!(process.env.BASE_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL);
  
  return hasUSDC && hasEscrow && hasRpc;
};

// Get ethers Provider
export const getProvider = (): ethers.JsonRpcProvider => {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 
                 process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || 
                 "https://sepolia.base.org";
  return new ethers.JsonRpcProvider(rpcUrl);
};

// Get Signer (Server-side only)
export const getSigner = (): ethers.Wallet => {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey || privateKey === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new Error("DEPLOYER_PRIVATE_KEY is not configured in .env file");
  }
  const provider = getProvider();
  return new ethers.Wallet(privateKey, provider);
};

// Helper to get USDC contract instance
export const getUSDCContract = (signerOrProvider?: ethers.Signer | ethers.Provider) => {
  const address = process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS || "0x85C3b89bd563ac3f915eC92534915ef1E13096d8";
  const connection = signerOrProvider || getProvider();
  return new ethers.Contract(address, MOCK_USDC_ABI, connection);
};

// Helper to get Escrow contract instance
export const getEscrowContract = (signerOrProvider?: ethers.Signer | ethers.Provider) => {
  const address = process.env.NEXT_PUBLIC_A2A_ESCROW_ADDRESS || "0x350c4B1028917Ff3EAeAeC98c58E77B7C0B9c4E2";
  const connection = signerOrProvider || getProvider();
  return new ethers.Contract(address, A2A_ESCROW_ABI, connection);
};

// Client-side helper to ensure connected Web3 wallet is on Base Sepolia
export const ensureBaseSepoliaNetwork = async (ethereum: any) => {
  if (!ethereum) return;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
    });
  } catch (switchError: any) {
    if (switchError.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BASE_SEPOLIA_CHAIN_ID,
            chainName: "Base Sepolia Testnet",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://sepolia.base.org"],
            blockExplorerUrls: ["https://sepolia.basescan.org"],
          },
        ],
      });
    }
  }
};
