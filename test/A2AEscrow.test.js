import { expect } from "chai";
import hre from "hardhat";

describe("A2AEscrow SLA Protocol", function () {
  let mockUSDC;
  let escrow;
  let buyer;
  let worker;

  beforeEach(async function () {
    const { ethers } = hre;
    [, buyer, worker] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    const mockUSDCAddress = await mockUSDC.getAddress();

    // Deploy A2AEscrow
    const A2AEscrow = await ethers.getContractFactory("A2AEscrow");
    escrow = await A2AEscrow.deploy(mockUSDCAddress);
    await escrow.waitForDeployment();

    // Mint USDC to buyer
    await mockUSDC.mint(buyer.address, ethers.parseUnits("500.0", 6));

    // Register worker agent
    await escrow.connect(worker).registerAgent(
      "Test Worker Agent",
      "/api/v1/agents/test",
      ethers.parseUnits("1.0", 6), // pricePerUnit
      30 // expectedLatency in seconds
    );
  });

  it("should register agent correctly", async function () {
    const agent = await escrow.registry(worker.address);
    expect(agent.isRegistered).to.equal(true);
    expect(agent.name).to.equal("Test Worker Agent");
    expect(agent.endpoint).to.equal("/api/v1/agents/test");
  });

  it("should create a job and lock escrow", async function () {
    const budget = ethers.parseUnits("100.0", 6);
    // Approve escrow
    await mockUSDC.connect(buyer).approve(await escrow.getAddress(), budget);

    // Create job
    await expect(escrow.connect(buyer).createJob(worker.address, budget, 30))
      .to.emit(escrow, "JobCreated")
      .withArgs(1, buyer.address, worker.address, budget, 30);

    const job = await escrow.jobs(1);
    expect(job.status).to.equal(0); // JobStatus.Active
    expect(job.budget).to.equal(budget);
    
    // Escrow contract should hold the USDC budget
    const escrowBalance = await mockUSDC.balanceOf(await escrow.getAddress());
    expect(escrowBalance).to.equal(budget);
  });

  it("should resolve a job with 100% payout to worker if completed within SLA", async function () {
    const budget = ethers.parseUnits("100.0", 6);
    await mockUSDC.connect(buyer).approve(await escrow.getAddress(), budget);
    await escrow.connect(buyer).createJob(worker.address, budget, 30);

    // Resolve job within SLA (elapsedTime: 20 seconds, max expectedLatency: 30 seconds)
    const tx = await escrow.connect(worker).resolveJob(1, 20, "ipfs://QmTestResult");
    await expect(tx)
      .to.emit(escrow, "JobResolved")
      .withArgs(1, budget, 0, 20, 1); // JobStatus.Completed = 1

    const job = await escrow.jobs(1);
    expect(job.status).to.equal(1); // Completed
    expect(job.payoutWorker).to.equal(budget);
    expect(job.refundBuyer).to.equal(0);

    // Worker should have the tokens
    const workerBalance = await mockUSDC.balanceOf(worker.address);
    expect(workerBalance).to.equal(budget);
  });

  it("should resolve a job with partial slashing if completed late", async function () {
    const budget = ethers.parseUnits("100.0", 6);
    await mockUSDC.connect(buyer).approve(await escrow.getAddress(), budget);
    await escrow.connect(buyer).createJob(worker.address, budget, 30);

    // Resolve job outside SLA (elapsedTime: 50 seconds, expectedLatency: 30 seconds, 20 seconds delay)
    // Penalty rate is 100 bps (1%) per second. 20s * 1% = 20% penalty.
    // Refund: 20% of 100 = 20. Payout: 80.
    const tx = await escrow.connect(worker).resolveJob(1, 50, "ipfs://QmTestResult");
    await expect(tx)
      .to.emit(escrow, "JobResolved")
      .withArgs(1, ethers.parseUnits("80.0", 6), ethers.parseUnits("20.0", 6), 50, 2); // JobStatus.Slashed = 2

    const job = await escrow.jobs(1);
    expect(job.status).to.equal(2); // Slashed
    expect(job.payoutWorker).to.equal(ethers.parseUnits("80.0", 6));
    expect(job.refundBuyer).to.equal(ethers.parseUnits("20.0", 6));

    // Check balances
    const workerBalance = await mockUSDC.balanceOf(worker.address);
    expect(workerBalance).to.equal(ethers.parseUnits("80.0", 6));

    const buyerBalance = await mockUSDC.balanceOf(buyer.address);
    // Initial 500 minus 100 budget plus 20 refund = 420
    expect(buyerBalance).to.equal(ethers.parseUnits("420.0", 6));
  });

  it("should resolve a job with 100% refund if completed extremely late", async function () {
    const budget = ethers.parseUnits("100.0", 6);
    await mockUSDC.connect(buyer).approve(await escrow.getAddress(), budget);
    await escrow.connect(buyer).createJob(worker.address, budget, 30);

    // Resolve job extremely late (elapsedTime: 140 seconds, expectedLatency: 30 seconds, 110 seconds delay)
    // 110 seconds delay * 1% = 110% penalty (capped at 100% / full refund).
    const tx = await escrow.connect(worker).resolveJob(1, 140, "ipfs://QmTestResult");
    await expect(tx)
      .to.emit(escrow, "JobResolved")
      .withArgs(1, 0, budget, 140, 3); // JobStatus.Refunded = 3

    const job = await escrow.jobs(1);
    expect(job.status).to.equal(3); // Refunded
    expect(job.payoutWorker).to.equal(0);
    expect(job.refundBuyer).to.equal(budget);

    // Check balances
    const workerBalance = await mockUSDC.balanceOf(worker.address);
    expect(workerBalance).to.equal(0);

    const buyerBalance = await mockUSDC.balanceOf(buyer.address);
    // Initial 500 minus 100 budget plus 100 refund = 500
    expect(buyerBalance).to.equal(ethers.parseUnits("500.0", 6));
  });

  it("should prevent non-authorized addresses from resolving", async function () {
    const budget = ethers.parseUnits("100.0", 6);
    await mockUSDC.connect(buyer).approve(await escrow.getAddress(), budget);
    await escrow.connect(buyer).createJob(worker.address, budget, 30);

    // Try to resolve from buyer address (revert)
    await expect(escrow.connect(buyer).resolveJob(1, 20, "ipfs://QmTestResult"))
      .to.be.revertedWith("Only the service agent or oracle can resolve");
  });
});
