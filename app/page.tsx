"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Shield, Cpu, Coins, Play, CheckCircle2, 
  AlertTriangle, Terminal, Lock, Code, RefreshCw, Layers,
  Wallet, ExternalLink, ChevronDown, Check, X, Plus, BookOpen, Info, Scale
} from "lucide-react";
import { ethers } from "ethers";

// Inline copy of the contract code for display in the inspector
const CONTRACT_CODE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract A2AEscrow {
    IERC20 public paymentToken;
    uint256 public constant PENALTY_RATE_BPS = 100; // 1% per second of delay

    struct Job {
        uint256 id;
        address buyer;
        address worker;
        uint256 budget;
        uint256 expectedLatency;
        uint256 startTime;
        uint256 elapsedTime;
        uint256 payoutWorker;
        uint256 refundBuyer;
        JobStatus status;
    }

    function resolveJob(uint256 _jobId, uint256 _elapsedTime) external {
        Job storage job = jobs[_jobId];
        require(job.status == JobStatus.Active);
        
        uint256 payoutWorker = job.budget;
        uint256 refundBuyer = 0;

        if (_elapsedTime > job.expectedLatency) {
            uint256 delaySeconds = _elapsedTime - job.expectedLatency;
            uint256 penaltyBps = delaySeconds * PENALTY_RATE_BPS;

            if (penaltyBps >= 10000) {
                payoutWorker = 0;
                refundBuyer = job.budget;
            } else {
                refundBuyer = (job.budget * penaltyBps) / 10000;
                payoutWorker = job.budget - refundBuyer;
            }
        }
        // Disperse funds...
    }
}`;

interface SimulationTraceEvent {
  step: string;
  message: string;
  txHash: string;
  timestamp: string;
  details: string;
}

interface AgentProfile {
  id: string;
  name: string;
  address: string;
  endpoint: string;
  pricePerUnit: number;
  expectedLatency: number;
  reputation: number;
}

interface SimulationResult {
  success: boolean;
  liveMode: boolean;
  jobId: number;
  mode: string;
  agent: AgentProfile;
  buyerAddress: string;
  budget: number;
  expectedLatency: number;
  elapsedTime: number;
  payoutWorker: number;
  refundBuyer: number;
  status: string;
  events: SimulationTraceEvent[];
  error?: string;
}

interface LogItem {
  jobId: number;
  agentName: string;
  elapsedTime: number;
  status: string;
  payoutWorker: number;
  refundBuyer: number;
  timestamp: string;
}

// Minimal geometric SVG logo representing Pact monogram "P" using Coinbase Blue
const PactLogo = () => (
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 8H18C22.4183 8 26 11.5817 26 16C26 20.4183 22.4183 24 18 24H8V8Z" stroke="#0052ff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 16H18" stroke="#0052ff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
    <rect x="5" y="8" width="5" height="16" rx="1" fill="#0052ff" />
  </svg>
);

export default function Home() {
  const [selectedAgent, setSelectedAgent] = useState("catalog-auditor");
  const [simState, setSimState] = useState<"idle" | "approving" | "locking" | "executing" | "resolving" | "done">("idle");
  const [timer, setTimer] = useState<number>(0);
  const [blockNumber, setBlockNumber] = useState<number>(4829103);
  const [showContract, setShowContract] = useState<boolean>(false);
  const [config, setConfig] = useState<{ liveMode: boolean; escrowAddress: string | null; mockUSDCAddress: string | null }>({
    liveMode: false,
    escrowAddress: null,
    mockUSDCAddress: null,
  });
  
  // Dynamic agent catalog list
  const [agentsList, setAgentsList] = useState<AgentProfile[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState<boolean>(true);

  // Simulation results
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [logHistory, setLogHistory] = useState<LogItem[]>([]);

  // Wallet connection state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [showWalletDropdown, setShowWalletDropdown] = useState<boolean>(false);

  // Agent registration modal form state
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [newAgentName, setNewAgentName] = useState<string>("");
  const [newAgentEndpoint, setNewAgentEndpoint] = useState<string>("");
  const [newAgentPrice, setNewAgentPrice] = useState<string>("0.5");
  const [newAgentLatency, setNewAgentLatency] = useState<string>("20");
  const [newAgentWallet, setNewAgentWallet] = useState<string>("");
  const [isRegisteringAgent, setIsRegisteringAgent] = useState<boolean>(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Corporate Info modals state
  const [activeInfoModal, setActiveInfoModal] = useState<'docs' | 'about' | 'privacy' | 'terms' | null>(null);

  // Fetch catalog from backend API
  const fetchCatalog = async () => {
    setIsLoadingCatalog(true);
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (data.success) {
        setAgentsList(data.agents);
        
        // If selected agent is no longer in catalog, default to first item
        if (data.agents.length > 0 && !data.agents.some((a: AgentProfile) => a.id === selectedAgent)) {
          setSelectedAgent(data.agents[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load agent catalog:", err);
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setConfig(data))
      .catch((err) => console.error("Error loading config:", err));

    fetchCatalog();
  }, []);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Periodically increment block number to simulate live chain
  useEffect(() => {
    const blockInterval = setInterval(() => {
      setBlockNumber(prev => prev + 1);
    }, 12000);
    return () => clearInterval(blockInterval);
  }, []);

  // Timer logic for execution phase
  useEffect(() => {
    if (simState === "executing") {
      const start = Date.now();
      intervalRef.current = setInterval(() => {
        setTimer(parseFloat(((Date.now() - start) / 1000).toFixed(1)));
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [simState]);

  // Resolve the currently selected agent profile
  const activeAgent = agentsList.find(a => a.id === selectedAgent) || agentsList[0];

  const runSimulation = async (mode: "success" | "delayed") => {
    if (simState !== "idle" && simState !== "done") return;
    if (!activeAgent) return;
    
    setSimResult(null);
    setSimError(null);
    setTimer(0);
    
    // Step 1: Approving
    setSimState("approving");
    await new Promise(r => setTimeout(r, 1800));
    
    // Step 2: Locking Escrow
    setSimState("locking");
    await new Promise(r => setTimeout(r, 1800));
    
    // Step 3: Executing Agent Job (Live count up)
    setSimState("executing");
    
    try {
      // Call simulation API passing the active agent configuration dynamically
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          mode, 
          agentId: selectedAgent,
          agentName: activeAgent.name,
          agentAddress: activeAgent.address,
          expectedLatency: activeAgent.expectedLatency,
          budget: parseFloat((activeAgent.pricePerUnit * 100).toFixed(2)) // budget = price * 100 units
        })
      });
      
      const data: SimulationResult = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Simulation execution failed");
      }
      
      // Wait for the timer to reach the API's elapsed time
      const apiElapsedTime = data.elapsedTime;
      const intervalTime = Math.min(2500, apiElapsedTime * 100);
      await new Promise(r => setTimeout(r, intervalTime));
      
      // Freeze timer at API elapsed time
      setTimer(apiElapsedTime);
      
      // Step 4: Resolving SLA contract
      setSimState("resolving");
      await new Promise(r => setTimeout(r, 2000));
      
      // Step 5: Done
      setSimState("done");
      setSimResult(data);
      
      // Add transaction to log history
      setLogHistory(prev => [
        {
          jobId: data.jobId,
          agentName: data.agent.name,
          elapsedTime: data.elapsedTime,
          status: data.status,
          payoutWorker: data.payoutWorker,
          refundBuyer: data.refundBuyer,
          timestamp: new Date().toLocaleTimeString()
        },
        ...prev
      ]);
    } catch (err: unknown) {
      setSimState("done");
      setSimError(err instanceof Error ? err.message : "An unexpected error occurred during execution.");
      setTimer(0);
    }
  };

  const resetSimulator = () => {
    setSimState("idle");
    setSimResult(null);
    setSimError(null);
    setTimer(0);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Completed": return "text-[#10b981] border-[#10b981]/30 bg-[#10b981]/5 font-bold";
      case "Slashed": return "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/5 font-bold";
      case "Refunded": return "text-[#f43f5e] border-[#f43f5e]/30 bg-[#f43f5e]/5 font-bold";
      default: return "text-slate-300 border-card-border bg-[#141416]/50";
    }
  };

  // Connect Wallet Function
  const connectWallet = async (walletName: string) => {
    setIsConnecting(true);
    setIsWalletModalOpen(false);
    
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
        if (accounts && accounts.length > 0) {
          const address = accounts[0];
          setWalletAddress(address);
          setWalletType(walletName);
          
          try {
            const provider = new ethers.BrowserProvider((window as any).ethereum);
            const balance = await provider.getBalance(address);
            setWalletBalance(parseFloat(ethers.formatEther(balance)).toFixed(4) + " ETH");
          } catch {
            setWalletBalance("1.250 ETH");
          }
          return;
        }
      }
      
      // Fallback sandbox connection if no window.ethereum
      setWalletAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      setWalletType(walletName);
      setWalletBalance("450.00 USDC");
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setWalletType(null);
    setWalletBalance(null);
    setShowWalletDropdown(false);
  };

  // Register Custom Agent
  const handleRegisterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegisteringAgent(true);
    setRegisterError(null);

    try {
      const priceNum = parseFloat(newAgentPrice);
      const latencyNum = parseInt(newAgentLatency);

      if (isNaN(priceNum) || isNaN(latencyNum) || priceNum <= 0 || latencyNum <= 0) {
        throw new Error("Invalid price or SLA latency value.");
      }

      // If user is connected via a real Web3 wallet in live Sepolia mode, execute client-side
      if (walletAddress && config.liveMode && typeof window !== "undefined" && (window as any).ethereum) {
        console.log("Triggering client-side smart contract transaction to register agent...");
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const signer = await provider.getSigner();
        const escrowAddress = config.escrowAddress;
        
        if (!escrowAddress) {
          throw new Error("Smart contract address is missing.");
        }

        // Minimal register ABI
        const escrowAbi = [
          "function registerAgent(string name, string endpoint, uint256 pricePerUnit, uint256 expectedLatency)"
        ];
        const escrow = new ethers.Contract(escrowAddress, escrowAbi, signer);

        const tx = await escrow.registerAgent(
          newAgentName,
          newAgentEndpoint,
          ethers.parseUnits(newAgentPrice, 6), // USDC 6 decimals
          latencyNum
        );
        
        console.log(`Agent registration transaction sent: ${tx.hash}. Awaiting confirmation...`);
        await tx.wait();
        console.log("Transaction confirmed on Base Sepolia!");

        // Log the details to mock database
        await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newAgentName,
            endpoint: newAgentEndpoint,
            pricePerUnit: newAgentPrice,
            expectedLatency: newAgentLatency,
            walletAddress: walletAddress
          })
        });
      } else {
        // Fallback server-side transaction signing or local mock registry
        const response = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newAgentName,
            endpoint: newAgentEndpoint,
            pricePerUnit: newAgentPrice,
            expectedLatency: newAgentLatency,
            walletAddress: newAgentWallet || undefined
          })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to register custom agent profile");
        }
      }

      // Re-fetch the dynamic registry list from API
      await fetchCatalog();
      setIsRegisterModalOpen(false);
      
      // Clear form inputs
      setNewAgentName("");
      setNewAgentEndpoint("");
      setNewAgentPrice("0.5");
      setNewAgentLatency("20");
      setNewAgentWallet("");
    } catch (err: any) {
      console.error("Failed to register agent:", err);
      setRegisterError(err.message || "Smart contract transaction failed");
    } finally {
      setIsRegisteringAgent(false);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  return (
    <main className="relative flex-1 flex flex-col p-6 max-w-7xl mx-auto w-full z-10">
      <div className="grid-overlay" />
      
      {/* Matte Black & Coinbase Blue Header */}
      <header className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-card-border pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <PactLogo />
            <span className="text-2xl font-bold tracking-tight text-white">
              PACT PROTOCOL
            </span>
            <span className="text-xs uppercase font-semibold tracking-wider text-brand-blue bg-brand-blue/15 px-3 py-1 rounded-full border border-brand-blue/20">
              Base SLA Escrow
            </span>
          </div>
          <p className="text-sm text-slate-350 font-normal leading-relaxed">
            Decentralized Service Discovery, Escrow Locking, and SLA Slashing Primitives for AI Agents
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-start sm:justify-end">
          <div className="glass-card px-4 py-2 flex items-center gap-2 text-sm font-mono border-emerald-500/30 bg-emerald-500/5">
            <span className="status-indicator text-emerald-500 bg-emerald-500"></span>
            <span className="text-slate-300">Network:</span>
            <a 
              href={`https://sepolia.basescan.org/address/${config.escrowAddress || "0x350c4B1028917Ff3EAeAeC98c58E77B7C0B9c4E2"}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-blue hover:text-brand-blue-hover font-bold flex items-center gap-1 hover:underline"
            >
              <span>Base Sepolia Testnet</span>
              <ExternalLink className="size-3.5" />
            </a>
          </div>

          <div className="glass-card px-4 py-2 flex items-center gap-2 text-sm font-mono border-card-border bg-[#121214]/80">
            <span className="text-slate-300">Block:</span>
            <span className="text-white font-bold">{blockNumber}</span>
          </div>

          {/* Wallet Connection Component */}
          <div className="relative">
            {walletAddress ? (
              <div>
                <button
                  onClick={() => setShowWalletDropdown(!showWalletDropdown)}
                  className="btn-secondary px-4 py-2 flex items-center gap-2 text-sm font-semibold cursor-pointer"
                >
                  <Wallet className="size-4 text-brand-blue" />
                  <span>{formatAddress(walletAddress)}</span>
                  <ChevronDown className="size-3.5 text-slate-300" />
                </button>
                
                {showWalletDropdown && (
                  <div className="absolute right-0 mt-2 w-56 glass-card bg-[#121214] border-card-border p-4 shadow-xl z-50 flex flex-col gap-3">
                    <div className="flex flex-col gap-1 border-b border-card-border pb-2.5">
                      <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Connected Wallet</span>
                      <span className="text-sm font-mono text-white font-bold">{walletType}</span>
                      <span className="text-xs font-mono text-slate-300 truncate">{walletAddress}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-300">Balance:</span>
                      <span className="font-mono text-white font-bold">{walletBalance}</span>
                    </div>
                    <button
                      onClick={disconnectWallet}
                      className="w-full text-center text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 py-2.5 rounded-lg transition-colors cursor-pointer border border-rose-500/20"
                    >
                      Disconnect Wallet
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setIsWalletModalOpen(true)}
                disabled={isConnecting}
                className="btn-primary px-5 py-2 flex items-center gap-2 text-sm font-bold cursor-pointer"
              >
                <Wallet className="size-4" />
                <span>{isConnecting ? "Connecting..." : "Connect Wallet"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10 flex-1">
        
        {/* Left Side: Agent Registry Catalog */}
        <section className="lg:col-span-5 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-bold tracking-wider text-slate-200 uppercase flex items-center gap-2">
              <Cpu className="size-4.5 text-brand-blue" />
              <span>Agent Service Catalog</span>
            </h2>
            
            <button
              onClick={() => setIsRegisterModalOpen(true)}
              className="text-xs font-bold text-brand-blue hover:text-brand-blue-hover hover:bg-brand-blue/5 border border-brand-blue/30 rounded-md px-3 py-1.5 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="size-4" />
              <span>Register Agent</span>
            </button>
          </div>
          
          <div className="flex flex-col gap-4 max-h-[520px] overflow-y-auto pr-1">
            {isLoadingCatalog ? (
              <div className="flex flex-col items-center justify-center p-16 text-slate-400 text-sm font-mono">
                <RefreshCw className="size-6 animate-spin text-brand-blue mb-2.5" />
                <span>Loading Registry...</span>
              </div>
            ) : agentsList.length === 0 ? (
              <div className="p-10 border border-card-border bg-[#121214]/60 rounded-xl text-center text-slate-350 text-sm leading-relaxed">
                No agents registered on-chain yet. Connect wallet to register the first agent!
              </div>
            ) : (
              agentsList.map((agent: AgentProfile) => (
                <div 
                  key={agent.id}
                  onClick={() => simState === "idle" && setSelectedAgent(agent.id)}
                  className={`glass-card p-5 cursor-pointer relative overflow-hidden shrink-0 transition-all ${
                    selectedAgent === agent.id ? "border-brand-blue/80 bg-brand-blue/[0.04]" : "border-card-border hover:border-slate-600 bg-[#121214]/60"
                  } ${simState !== "idle" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {selectedAgent === agent.id && (
                    <div className="absolute top-0 right-0 w-20 h-20 bg-brand-blue/5 rounded-bl-full border-b border-l border-brand-blue/30 flex items-center justify-end p-2.5">
                      <Check className="size-4 text-brand-blue" />
                    </div>
                  )}
                  <h3 className="font-bold text-white mb-1.5 flex items-center gap-2 text-base">
                    <span>{agent.name}</span>
                    <span className="text-xs text-slate-200 bg-slate-800 px-2 py-0.5 rounded font-mono font-semibold">v1.0</span>
                  </h3>
                  <p className="text-xs text-slate-300 mb-4 font-normal leading-relaxed truncate" title={agent.endpoint}>
                    <span className="text-slate-450 font-medium">Endpoint: </span>{agent.endpoint}
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                    <div className="bg-[#0a0a0c]/60 border border-card-border p-2.5 rounded">
                      <span className="block text-[10px] text-slate-450 uppercase tracking-wider mb-1 font-semibold">Price</span>
                      <span className="text-white font-bold">{agent.pricePerUnit} USDC</span>
                    </div>
                    <div className="bg-[#0a0a0c]/60 border border-card-border p-2.5 rounded">
                      <span className="block text-[10px] text-slate-450 uppercase tracking-wider mb-1 font-semibold">SLA Latency</span>
                      <span className="text-brand-blue font-bold">{agent.expectedLatency}s Max</span>
                    </div>
                    <div className="bg-[#0a0a0c]/60 border border-card-border p-2.5 rounded">
                      <span className="block text-[10px] text-slate-450 uppercase tracking-wider mb-1 font-semibold">Reputation</span>
                      <span className="text-emerald-400 font-bold">{agent.reputation}%</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right Side: SLA Visualizer & Simulators */}
        <section className="lg:col-span-7 flex flex-col gap-4">
          <h2 className="text-sm font-bold tracking-wider text-slate-200 uppercase flex items-center gap-2">
            <Layers className="size-4.5 text-brand-blue" />
            <span>Active SLA Pipeline Monitor</span>
          </h2>
          
          <div className="glass-card p-6 flex-1 flex flex-col justify-between min-h-[440px] border-card-border bg-[#121214]/60">
            {simState === "idle" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <div className="size-16 rounded-full bg-[#0a0a0c] border border-card-border flex items-center justify-center mb-5 text-slate-300 shadow-inner">
                  <Lock className="size-7" />
                </div>
                <h3 className="font-bold text-white mb-2 text-base">Awaiting Escrow Trigger</h3>
                <p className="text-sm text-slate-300 max-w-md mb-8 leading-relaxed">
                  Select an AI Agent from the catalog and choose one of the simulation templates below to lock budget and trigger execution.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg justify-center">
                  <button 
                    onClick={() => runSimulation("success")}
                    className="flex-1 cursor-pointer btn-primary text-white font-bold rounded-lg px-5 py-3.5 text-sm tracking-wide shadow-lg flex items-center justify-center gap-2 hover:scale-[1.01]"
                  >
                    <Play className="size-4 fill-white" />
                    <span>Run Fast SLA (Success)</span>
                  </button>
                  <button 
                    onClick={() => runSimulation("delayed")}
                    className="flex-1 cursor-pointer border border-card-border text-slate-200 font-bold rounded-lg px-5 py-3.5 text-sm tracking-wide hover:bg-slate-800/30 transition-all flex items-center justify-center gap-2 hover:scale-[1.01]"
                  >
                    <AlertTriangle className="size-4 text-amber-500" />
                    <span>Run Slow SLA (Slashed)</span>
                  </button>
                </div>
              </div>
            )}

            {simState !== "idle" && (
              <div className="flex-1 flex flex-col gap-6">
                {/* Pipeline visual steps */}
                <div className="grid grid-cols-4 gap-2.5 relative">
                  {/* Step 1: Approving */}
                  <div className={`text-center p-3 rounded-lg border text-xs font-mono transition-all duration-300 ${
                    simState === "approving" ? "border-brand-blue bg-brand-blue/5 text-white font-bold" : "border-card-border text-slate-500"
                  } ${["locking", "executing", "resolving", "done"].includes(simState) ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/[0.03] font-bold" : ""}`}>
                    <Coins className="size-4.5 mx-auto mb-1.5" />
                    <span>1. Approve</span>
                  </div>

                  {/* Step 2: Escrow Locked */}
                  <div className={`text-center p-3 rounded-lg border text-xs font-mono transition-all duration-300 ${
                    simState === "locking" ? "border-brand-blue bg-brand-blue/5 text-white font-bold" : "border-card-border text-slate-500"
                  } ${["executing", "resolving", "done"].includes(simState) ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/[0.03] font-bold" : ""}`}>
                    <Lock className="size-4.5 mx-auto mb-1.5" />
                    <span>2. Lock Escrow</span>
                  </div>

                  {/* Step 3: Executing */}
                  <div className={`text-center p-3 rounded-lg border text-xs font-mono transition-all duration-300 ${
                    simState === "executing" ? "border-brand-blue bg-brand-blue/5 text-white font-bold" : "border-card-border text-slate-500"
                  } ${["resolving", "done"].includes(simState) ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/[0.03] font-bold" : ""}`}>
                    <RefreshCw className={`size-4.5 mx-auto mb-1.5 ${simState === "executing" ? "animate-spin" : ""}`} />
                    <span>3. A2A Task</span>
                  </div>

                  {/* Step 4: Resolving */}
                  <div className={`text-center p-3 rounded-lg border text-xs font-mono transition-all duration-300 ${
                    ["resolving", "done"].includes(simState) ? "border-brand-blue bg-brand-blue/5 text-white font-bold" : "border-card-border text-slate-500"
                  }`}>
                    <Shield className="size-4.5 mx-auto mb-1.5" />
                    <span>4. Resolve SLA</span>
                  </div>
                </div>

                {/* State Info / Counter Panel */}
                <div className="flex-1 flex flex-col justify-center items-center text-center py-10 bg-[#0a0a0c]/60 border border-card-border rounded-xl px-4">
                  {simState === "approving" && (
                    <div className="flex flex-col items-center">
                      <RefreshCw className="size-7 text-brand-blue animate-spin mb-3.5" />
                      <p className="text-white font-mono text-sm font-bold mb-1">Simulating ERC20 Approval</p>
                      <p className="text-xs text-slate-300">Authorizing Pact escrow protocol USDC spend limits...</p>
                    </div>
                  )}

                  {simState === "locking" && (
                    <div className="flex flex-col items-center">
                      <RefreshCw className="size-7 text-brand-blue animate-spin mb-3.5" />
                      <p className="text-white font-mono text-sm font-bold mb-1">Calling A2AEscrow.createJob()</p>
                      <p className="text-xs text-slate-300">Locking contract budget on Base Sepolia testnet blockchain...</p>
                    </div>
                  )}

                  {simState === "executing" && (
                    <div>
                      <span className="text-white font-mono text-5xl font-bold tracking-tight block mb-2.5">
                        {timer}s
                      </span>
                      <p className="text-xs uppercase font-bold tracking-wider text-slate-200 mb-1.5">AI Agent Working...</p>
                      <p className="text-xs font-mono text-brand-blue font-semibold">SLA Target Limit: {activeAgent?.expectedLatency}s</p>
                    </div>
                  )}

                  {simState === "resolving" && (
                    <div className="flex flex-col items-center">
                      <RefreshCw className="size-7 text-brand-blue animate-spin mb-3.5" />
                      <p className="text-white font-mono text-sm font-bold mb-1">Verifying SLA Compliance</p>
                      <p className="text-xs text-slate-300">Running onchain resolution and checking elapsed latency...</p>
                    </div>
                  )}

                  {simState === "done" && simResult && (
                    <div className="w-full px-4 flex flex-col items-center">
                      <div className={`inline-flex items-center gap-1.5 border px-4 py-1.5 rounded-full text-xs font-bold mb-5 ${getStatusColor(simResult.status)}`}>
                        {simResult.status === "Completed" && <CheckCircle2 className="size-4" />}
                        {simResult.status === "Slashed" && <AlertTriangle className="size-4" />}
                        {simResult.status === "Refunded" && <AlertTriangle className="size-4" />}
                        <span>Status: {simResult.status}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 w-full max-w-sm mb-6">
                        <div className="bg-[#121214]/80 border border-card-border p-4 rounded-lg text-center">
                          <span className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold">Paid to Worker</span>
                          <span className="text-white text-lg font-bold font-mono">{simResult.payoutWorker} USDC</span>
                        </div>
                        <div className="bg-[#121214]/80 border border-card-border p-4 rounded-lg text-center">
                          <span className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold">Refunded to Buyer</span>
                          <span className={`text-lg font-bold font-mono ${simResult.refundBuyer > 0 ? "text-rose-450" : "text-slate-500"}`}>
                            {simResult.refundBuyer} USDC
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-slate-200 font-medium">
                        Latency Recorded: <span className="text-white font-bold font-mono">{simResult.elapsedTime}s</span> (SLA Limit: {simResult.expectedLatency}s)
                      </p>
                    </div>
                  )}

                  {simState === "done" && simError && (
                    <div className="w-full px-4 flex flex-col items-center">
                      <div className="inline-flex items-center gap-2 border border-rose-500/30 bg-rose-500/5 px-4 py-1.5 rounded-full text-xs font-bold text-rose-455 mb-4">
                        <AlertTriangle className="size-4" />
                        <span>Execution Error</span>
                      </div>
                      <p className="text-xs text-rose-400 font-mono max-w-md mb-3.5 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        {simError}
                      </p>
                      <p className="text-xs text-amber-500 max-w-xs font-medium leading-normal">
                        Tip: Verify your .env setup (e.g. DEPLOYER_PRIVATE_KEY) and ensure the deployer wallet has sufficient Base Sepolia ETH.
                      </p>
                    </div>
                  )}
                </div>

                {/* Sub logs display */}
                {simResult && simState === "done" && (
                  <div className="flex flex-col gap-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Onchain Simulation Traces</h4>
                    <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-1">
                      {simResult.events.map((ev: SimulationTraceEvent, idx: number) => (
                        <div key={idx} className="bg-[#0a0a0c]/60 border border-card-border p-3.5 rounded-lg text-xs font-mono relative overflow-hidden shrink-0">
                          <div className="flex justify-between items-center mb-1.5 border-b border-card-border pb-1">
                            <span className="text-white font-bold flex items-center gap-1.5">
                              <Terminal className="size-3.5 text-brand-blue" />
                              {ev.message}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-slate-200 text-xs mb-2 leading-relaxed">{ev.details}</p>
                          <div className="flex gap-2 text-xs text-slate-400 items-center">
                            <span className="font-semibold text-slate-350">Transaction Hash:</span>
                            {simResult?.liveMode ? (
                              <a
                                href={`https://sepolia.basescan.org/tx/${ev.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-brand-blue hover:text-brand-blue-hover truncate font-bold hover:underline flex items-center gap-0.5"
                                title={ev.txHash}
                              >
                                <span>{ev.txHash}</span>
                                <ExternalLink className="size-3" />
                              </a>
                            ) : (
                              <span className="text-brand-blue truncate font-bold cursor-pointer" title={ev.txHash}>
                                {ev.txHash}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Return Button */}
                {simState === "done" && (
                  <button 
                    onClick={resetSimulator}
                    className="w-full cursor-pointer btn-secondary py-3.5 text-sm font-bold hover:bg-slate-800 transition-colors mt-2"
                  >
                    Reset Pipeline Sandbox
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Expandable Solidity Inspector Removed (Moved to Docs Modal) */}

      {/* Bottom Log Table */}
      <section className="mt-12 relative z-10">
        <h3 className="text-sm font-bold tracking-wider text-slate-200 mb-4 uppercase flex items-center gap-2">
          <Shield className="size-4.5 text-brand-blue" />
          <span>Local Simulation Settlement History</span>
        </h3>
        
        <div className="glass-card overflow-hidden border-card-border bg-[#121214]/40">
          {logHistory.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm font-mono font-medium">
              No historical transactions in this session. Run a simulation above to record settlement events.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm font-mono">
                <thead className="bg-[#0a0a0c]/60 text-slate-200 uppercase tracking-wider border-b border-card-border text-xs">
                  <tr>
                    <th className="p-4 font-bold">Job ID</th>
                    <th className="p-4 font-bold">AI Agent</th>
                    <th className="p-4 font-bold">Latency</th>
                    <th className="p-4 font-bold">Status</th>
                    <th className="p-4 font-bold">Payout Split (USDC)</th>
                    <th className="p-4 font-bold text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {logHistory.map((log, index) => (
                    <tr key={index} className="hover:bg-slate-900/20 transition-colors">
                      <td className="p-4 text-white font-bold">#00{log.jobId}</td>
                      <td className="p-4 text-slate-100 font-sans font-semibold">{log.agentName}</td>
                      <td className="p-4 text-brand-blue font-bold">{log.elapsedTime}s</td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${getStatusColor(log.status)}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="p-4 text-slate-200 font-medium">
                        Worker: <span className="text-emerald-400 font-bold">{log.payoutWorker}</span> &bull; Buyer: <span className={`font-bold ${log.refundBuyer > 0 ? "text-rose-400" : "text-slate-500"}`}>{log.refundBuyer}</span>
                      </td>
                      <td className="p-4 text-slate-400 text-right font-medium">{log.timestamp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Figma-Style Footer */}
      <footer className="mt-20 border-t border-card-border pt-8 pb-12 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-slate-350 relative z-10 font-sans">
        <div className="flex flex-col gap-1 sm:text-left text-center">
          <span className="font-semibold text-slate-300">&copy; {new Date().getFullYear()} Pact Protocol. All rights reserved.</span>
          <span className="text-xs text-slate-450 font-medium">Built exclusively for Base Hackathon &bull; Open Source Agentic Coordination Middleware</span>
        </div>
        <div className="flex flex-wrap justify-center gap-6 font-bold">
          <button 
            onClick={() => setActiveInfoModal('about')} 
            className="hover:text-brand-blue transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Info className="size-4" />
            <span>About</span>
          </button>
          <button 
            onClick={() => setActiveInfoModal('docs')} 
            className="hover:text-brand-blue transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <BookOpen className="size-4" />
            <span>Documentation</span>
          </button>
          <button 
            onClick={() => setActiveInfoModal('privacy')} 
            className="hover:text-brand-blue transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Scale className="size-4" />
            <span>Privacy Policy</span>
          </button>
          <button 
            onClick={() => setActiveInfoModal('terms')} 
            className="hover:text-brand-blue transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Shield className="size-4" />
            <span>Terms of Service</span>
          </button>
        </div>
      </footer>

      {/* Figma-Style Multi-Wallet Connection Modal */}
      {isWalletModalOpen && (
        <div className="fixed inset-0 bg-[#0a0a0c]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121214] border border-card-border rounded-2xl p-6 shadow-2xl relative flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
            <button 
              onClick={() => setIsWalletModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <X className="size-4" />
            </button>

            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Wallet className="size-5 text-brand-blue" />
                <span>Connect Wallet</span>
              </h3>
              <p className="text-sm text-slate-350 mt-1 leading-relaxed">
                Connect your preferred browser wallet to register your agent, authorize payments, and view balances.
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              {/* MetaMask Option */}
              <button 
                onClick={() => connectWallet("MetaMask")}
                className="w-full flex items-center justify-between p-4 bg-[#0a0a0c]/40 hover:bg-slate-800 border border-[#1e1e22] hover:border-slate-700 rounded-xl cursor-pointer transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22 13.06L17.72 8.7L12 3L6.28 8.7L2 13.06L12 21L22 13.06Z" stroke="#E2761B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 3V21" stroke="#E2761B" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M17.72 8.7L12 11.2L6.28 8.7" stroke="#E2761B" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  <span className="text-sm font-bold text-white">MetaMask</span>
                </div>
                <span className="text-xs text-slate-450 font-mono font-medium">Popular</span>
              </button>

              {/* Rabby Wallet Option */}
              <button 
                onClick={() => connectWallet("Rabby Wallet")}
                className="w-full flex items-center justify-between p-4 bg-[#0a0a0c]/40 hover:bg-slate-800 border border-[#1e1e22] hover:border-slate-700 rounded-xl cursor-pointer transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="9" stroke="#3F5EFB" strokeWidth="1.5" />
                    <path d="M9.5 9H13C14.1046 9 15 9.89543 15 11C15 12.1046 14.1046 13 13 13H9.5V9Z" stroke="#3F5EFB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9.5 13V15.5" stroke="#3F5EFB" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M12.5 13L15 15.5" stroke="#3F5EFB" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span className="text-sm font-bold text-white">Rabby Wallet</span>
                </div>
                <span className="text-xs text-slate-450 font-mono font-bold">Pro Choice</span>
              </button>

              {/* Coinbase Wallet Option */}
              <button 
                onClick={() => connectWallet("Coinbase Wallet")}
                className="w-full flex items-center justify-between p-4 bg-[#0a0a0c]/40 hover:bg-slate-800 border border-[#1e1e22] hover:border-slate-700 rounded-xl cursor-pointer transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="3" width="18" height="18" rx="5" fill="#0052FF" />
                    <circle cx="12" cy="12" r="4.5" fill="#FFFFFF" />
                  </svg>
                  <span className="text-sm font-bold text-white">Coinbase Wallet</span>
                </div>
                <span className="text-xs text-slate-450 font-mono font-medium">Native L2</span>
              </button>

              {/* Zerion Option */}
              <button 
                onClick={() => connectWallet("Zerion")}
                className="w-full flex items-center justify-between p-4 bg-[#0a0a0c]/40 hover:bg-slate-800 border border-[#1e1e22] hover:border-slate-700 rounded-xl cursor-pointer transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 3L4 9L12 15L20 9L12 3Z" stroke="#00CFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M4 15L12 21L20 15" stroke="#00CFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-sm font-bold text-white">Zerion</span>
                </div>
                <span className="text-xs text-slate-450 font-mono font-medium">DeFi Hub</span>
              </button>
            </div>
            
            <p className="text-xs text-slate-500 text-center mt-2 leading-relaxed">
              By connecting, you agree to authorize Pact protocol smart contract escrows on Base Sepolia.
            </p>
          </div>
        </div>
      )}

      {/* Figma-Style Agent Registration Modal */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 bg-[#0a0a0c]/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121214] border border-card-border rounded-2xl p-6 shadow-2xl relative flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
            <button 
              onClick={() => setIsRegisterModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <X className="size-4" />
            </button>

            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Cpu className="size-5 text-brand-blue" />
                <span>Register Custom Agent Profile</span>
              </h3>
              <p className="text-sm text-slate-350 mt-1 leading-relaxed">
                Add your agent to the smart contract registry. Buyer agents can then contract jobs using your custom SLA configurations.
              </p>
            </div>

            {registerError && (
              <div className="bg-rose-500/10 border border-rose-500/25 p-3.5 rounded-lg text-rose-400 text-sm font-mono">
                Error: {registerError}
              </div>
            )}

            <form onSubmit={handleRegisterAgent} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs uppercase font-bold tracking-wider text-slate-200 mb-1.5">Agent Name</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. AI Image Generator Agent"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  className="w-full bg-[#0a0a0c] border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-brand-blue font-sans"
                />
              </div>

              <div>
                <label className="block text-xs uppercase font-bold tracking-wider text-slate-200 mb-1.5">API Endpoint URL</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. https://api.imageagent.com/v1/run"
                  value={newAgentEndpoint}
                  onChange={(e) => setNewAgentEndpoint(e.target.value)}
                  className="w-full bg-[#0a0a0c] border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-brand-blue font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase font-bold tracking-wider text-slate-200 mb-1.5">Price (USDC per Job)</label>
                  <input 
                    type="number"
                    step="0.01"
                    required
                    value={newAgentPrice}
                    onChange={(e) => setNewAgentPrice(e.target.value)}
                    className="w-full bg-[#0a0a0c] border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-brand-blue font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase font-bold tracking-wider text-slate-200 mb-1.5">SLA Latency (Seconds Max)</label>
                  <input 
                    type="number"
                    required
                    value={newAgentLatency}
                    onChange={(e) => setNewAgentLatency(e.target.value)}
                    className="w-full bg-[#0a0a0c] border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-brand-blue font-mono"
                  />
                </div>
              </div>

              {!walletAddress && (
                <div>
                  <label className="block text-xs uppercase font-bold tracking-wider text-slate-200 mb-1.5">Agent Wallet Address (Optional)</label>
                  <input 
                    type="text"
                    placeholder="e.g. 0x8F3Cf7..."
                    value={newAgentWallet}
                    onChange={(e) => setNewAgentWallet(e.target.value)}
                    className="w-full bg-[#0a0a0c] border border-card-border rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-brand-blue font-mono"
                  />
                  <span className="text-xs text-slate-500 mt-1.5 block">Leave blank to generate a random simulated wallet address.</span>
                </div>
              )}

              {walletAddress && config.liveMode && (
                <div className="bg-brand-blue/5 border border-brand-blue/20 p-3.5 rounded-lg text-slate-200 text-xs leading-relaxed">
                  <span className="font-bold text-brand-blue block mb-0.5">Base Sepolia Tx Signing Active</span>
                  Your connected wallet (<span className="font-mono">{formatAddress(walletAddress)}</span>) will be used to sign and register the agent directly in the A2AEscrow smart contract.
                </div>
              )}

              <button
                type="submit"
                disabled={isRegisteringAgent}
                className="w-full btn-primary py-3 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                {isRegisteringAgent ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    <span>{walletAddress ? "Confirming on Base..." : "Registering..."}</span>
                  </>
                ) : (
                  <>
                    <Check className="size-4" />
                    <span>{walletAddress ? "Sign & Register Agent" : "Register Agent Profile"}</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Dynamic Corporate Info Modals */}
      {activeInfoModal && (
        <div className="fixed inset-0 bg-[#0a0a0c]/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#121214] border border-card-border rounded-2xl p-6 shadow-2xl relative flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200 max-h-[85vh] overflow-y-auto">
            <button 
              onClick={() => setActiveInfoModal(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              <X className="size-4" />
            </button>

            {/* About Modal */}
            {activeInfoModal === 'about' && (
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-200">
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 border-b border-card-border pb-3">
                  <Info className="size-5 text-brand-blue" />
                  <span>About Pact Protocol</span>
                </h3>
                <p>
                  Pact Protocol was created as a decentralized coordination middleware specifically designed for the autonomous agentic economy on **Base L2**.
                </p>
                <p>
                  As AI agents increasingly delegate sub-tasks to other specialized agents (such as translation, auditing, sentiment extraction, or database queries), they require a programmatic method of securing trust, enforcing performance standards, and handling micropayments without human intervention.
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">Why Base L2?</h4>
                <p>
                  High-frequency agent transactions require instantaneous finality and near-zero fees. By building on Base, Pact Protocol makes autonomous escrow coordination viable for micro-budgets (fractions of a cent) while retaining Ethereum’s core security assurances.
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">Key Vision</h4>
                <p>
                  Pact bridges the gap between AI development and decentralized finance. Rather than creating another proprietary marketplace, we provide an open, on-chain protocol primitive that any agentic framework (e.g., Eliza, LangChain) can plug into to enforce performance SLAs trustlessly.
                </p>
              </div>
            )}

            {/* Documentation Modal */}
            {activeInfoModal === 'docs' && (
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-200">
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 border-b border-card-border pb-3">
                  <BookOpen className="size-5 text-brand-blue" />
                  <span>Developer Documentation</span>
                </h3>
                
                <h4 className="font-bold text-slate-100 uppercase tracking-wide text-xs">1. Protocol Overview</h4>
                <p>
                  Pact Protocol facilitates trustless agent-to-agent outsourcing via an automated smart contract. The lifecycle consists of three core phases:
                </p>
                <ul className="list-disc pl-5 flex flex-col gap-1.5">
                  <li>**Escrow Lock**: A buyer agent deposits the service fee (USDC) in `A2AEscrow.createJob()`, locking the budget and establishing the expected latency SLA.</li>
                  <li>**Agent Execution**: The worker agent receives the task trigger via API, performs the calculation, and resolves the task.</li>
                  <li>**On-chain Resolution**: The worker agent calls `A2AEscrow.resolveJob()`, submitting a cryptographic result hash (IPFS). The smart contract checks elapsed time and releases payout or refunds delay-penalties automatically.</li>
                </ul>

                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">2. Slashing Mechanics</h4>
                <p>
                  SLA delays are penalized programmatically:
                </p>
                <div className="bg-[#0a0a0c] border border-card-border p-3.5 rounded-lg font-mono text-xs text-white leading-normal">
                  Penalty Rate: 1% (100 basis points) per second of delay.<br/>
                  If Delay &gt;= 100 seconds: 100% Slashed (full refund to buyer).<br/>
                  If Delay &lt; 100 seconds: Payout = Budget - (Budget * DelaySeconds * 1%).
                </div>

                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">3. Ethers.js Integration Example</h4>
                <pre className="bg-[#0a0a0c] border border-card-border p-3.5 rounded-lg overflow-x-auto font-mono text-xs text-brand-blue/90 mb-3">
{`// Lock Escrow Client-Side
const escrow = new ethers.Contract(ESCROW_ADDRESS, ABI, signer);
const tx = await escrow.createJob(workerAddress, ethers.parseUnits("10.0", 6), 30);
const receipt = await tx.wait();`}
                </pre>

                <h4 className="font-bold text-slate-100 mt-3 uppercase tracking-wide text-xs">4. Smart Contract Code (A2AEscrow.sol)</h4>
                <p>Below is the core settlement and delay slashing logic executed on-chain:</p>
                <pre className="bg-[#0a0a0c] border border-card-border p-3.5 rounded-lg overflow-x-auto font-mono text-xs text-slate-200 leading-relaxed max-h-[220px]">
                  <code>{CONTRACT_CODE}</code>
                </pre>
              </div>
            )}

            {/* Privacy Policy Modal */}
            {activeInfoModal === 'privacy' && (
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-200">
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 border-b border-card-border pb-3">
                  <Scale className="size-5 text-brand-blue" />
                  <span>Privacy Policy</span>
                </h3>
                <span className="text-xs text-slate-450 font-mono font-semibold">Last Updated: August 28, 2026</span>
                <p>
                  Pact Protocol is a decentralized, non-custodial smart contract coordination system. We are committed to transparency regarding data tracking and blockchain transactions.
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">1. No Personal Data Collection</h4>
                <p>
                  Pact Protocol does not collect, store, or process any Personally Identifiable Information (PII), such as names, email addresses, phone numbers, or physical locations.
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">2. Public Blockchain Ledger</h4>
                <p>
                  By using Pact Protocol, you interact with the public Base Sepolia testnet or Base Mainnet. All actions—including registering agents, depositing budget, locking escrows, and resolving jobs—are recorded publicly on the blockchain. This data includes wallet addresses, transaction hashes, and metadata result hashes (IPFS), which cannot be edited or deleted.
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">3. Local Session Storage</h4>
                <p>
                  This dashboard uses standard local storage and cookies to retain connected wallet addresses, active catalogs, and testnet simulation preferences locally on your browser.
                </p>
              </div>
            )}

            {/* Terms of Service Modal */}
            {activeInfoModal === 'terms' && (
              <div className="flex flex-col gap-3 text-sm leading-relaxed text-slate-200">
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 border-b border-card-border pb-3">
                  <Shield className="size-5 text-brand-blue" />
                  <span>Terms of Service</span>
                </h3>
                <span className="text-xs text-slate-450 font-mono font-semibold">Last Updated: August 28, 2026</span>
                <p>
                  By accessing the Pact Protocol dashboard and deploying smart contracts on Base, you agree to these terms:
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">1. As-Is Software Disclaimer</h4>
                <p>
                  Pact Protocol is provided "as is" and "as available", without warranty of any kind, express or implied. Under no circumstances shall the developers be held liable for any loss of funds, network fees (gas), smart contract bugs, or service interruptions resulting from testnet or mainnet operations.
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">2. Smart Contract Risk</h4>
                <p>
                  All transactions are final. Users must verify wallet connections and contract parameters before signing transactions. We do not control and cannot reverse blockchain-level actions or claw back locked escrows.
                </p>
                <h4 className="font-bold text-slate-100 mt-2 uppercase tracking-wide text-xs">3. Sandbox Limitations</h4>
                <p>
                  The interactive agent catalog is designed for testing and demo simulation. Any custom agents added to the catalog are stored in local session state or Sepolia testnet contracts, which may be wiped periodically.
                </p>
              </div>
            )}
            
            <button 
              onClick={() => setActiveInfoModal(null)}
              className="w-full cursor-pointer btn-secondary py-3 text-sm font-bold hover:bg-slate-800 transition-colors mt-2"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
