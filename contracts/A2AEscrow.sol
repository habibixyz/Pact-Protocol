// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract A2AEscrow {
    address public owner;
    IERC20 public paymentToken;
    
    // Slashing rate: 1% (100 basis points) penalty per second of delay
    // represented as basis points (10000 = 100%)
    uint256 public constant PENALTY_RATE_BPS = 100; // 1% per second of delay
    uint256 public constant BPS_DENOMINATOR = 10000;

    enum JobStatus { Active, Completed, Slashed, Refunded }

    struct Agent {
        address wallet;
        string name;
        string endpoint;
        uint256 pricePerUnit; // in tokens
        uint256 expectedLatency; // in seconds
        bool isRegistered;
    }

    struct Job {
        uint256 id;
        address buyer;
        address worker;
        uint256 budget;
        uint256 expectedLatency;
        uint256 startTime;
        uint256 resolutionTime;
        uint256 elapsedTime;
        uint256 payoutWorker;
        uint256 refundBuyer;
        JobStatus status;
        string resultHash;
    }

    mapping(address => Agent) public registry;
    address[] public registeredAgents;
    
    mapping(uint256 => Job) public jobs;
    uint256 public jobCount;

    event AgentRegistered(address indexed wallet, string name, string endpoint, uint256 pricePerUnit, uint256 expectedLatency);
    event JobCreated(uint256 indexed jobId, address indexed buyer, address indexed worker, uint256 budget, uint256 expectedLatency);
    event JobResolved(uint256 indexed jobId, uint256 payoutWorker, uint256 refundBuyer, uint256 elapsedTime, JobStatus status);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call");
        _;
    }

    constructor(address _paymentToken) {
        owner = msg.sender;
        paymentToken = IERC20(_paymentToken);
    }

    function registerAgent(
        string memory _name,
        string memory _endpoint,
        uint256 _pricePerUnit,
        uint256 _expectedLatency
    ) external {
        if (!registry[msg.sender].isRegistered) {
            registeredAgents.push(msg.sender);
        }
        
        registry[msg.sender] = Agent({
            wallet: msg.sender,
            name: _name,
            endpoint: _endpoint,
            pricePerUnit: _pricePerUnit,
            expectedLatency: _expectedLatency,
            isRegistered: true
        });

        emit AgentRegistered(msg.sender, _name, _endpoint, _pricePerUnit, _expectedLatency);
    }

    function createJob(address _worker, uint256 _budget, uint256 _expectedLatency) external returns (uint256) {
        require(registry[_worker].isRegistered, "Worker agent is not registered");
        require(_budget > 0, "Budget must be greater than zero");
        
        // Transfer USDC to escrow
        require(paymentToken.transferFrom(msg.sender, address(this), _budget), "Payment transfer failed");

        jobCount++;
        jobs[jobCount] = Job({
            id: jobCount,
            buyer: msg.sender,
            worker: _worker,
            budget: _budget,
            expectedLatency: _expectedLatency,
            startTime: block.timestamp,
            resolutionTime: 0,
            elapsedTime: 0,
            payoutWorker: 0,
            refundBuyer: 0,
            status: JobStatus.Active,
            resultHash: ""
        });

        emit JobCreated(jobCount, msg.sender, _worker, _budget, _expectedLatency);
        return jobCount;
    }

    /**
     * @dev Resolves a job, calculating SLA compliance and dispersing payouts.
     * In a production setup, this would verify a signature from a decentralized consensus
     * or a trusted oracle/validator node. For this demo, it supports direct execution.
     */
    function resolveJob(uint256 _jobId, uint256 _elapsedTime, string memory _resultHash) external {
        Job storage job = jobs[_jobId];
        require(job.status == JobStatus.Active, "Job is not active");
        require(msg.sender == job.worker || msg.sender == owner, "Only the service agent or oracle can resolve");

        job.resolutionTime = block.timestamp;
        job.elapsedTime = _elapsedTime;
        job.resultHash = _resultHash;

        uint256 payoutWorker = job.budget;
        uint256 refundBuyer = 0;
        JobStatus finalStatus = JobStatus.Completed;

        // SLA Check: If execution was slower than expected, calculate slashing
        if (_elapsedTime > job.expectedLatency) {
            uint256 delaySeconds = _elapsedTime - job.expectedLatency;
            uint256 penaltyBps = delaySeconds * PENALTY_RATE_BPS;

            if (penaltyBps >= BPS_DENOMINATOR) {
                // Slashed 100%
                payoutWorker = 0;
                refundBuyer = job.budget;
                finalStatus = JobStatus.Refunded;
            } else {
                // Slashed partially
                refundBuyer = (job.budget * penaltyBps) / BPS_DENOMINATOR;
                payoutWorker = job.budget - refundBuyer;
                finalStatus = JobStatus.Slashed;
            }
        }

        job.payoutWorker = payoutWorker;
        job.refundBuyer = refundBuyer;
        job.status = finalStatus;

        // Disperse funds
        if (payoutWorker > 0) {
            require(paymentToken.transfer(job.worker, payoutWorker), "Payout transfer failed");
        }
        if (refundBuyer > 0) {
            require(paymentToken.transfer(job.buyer, refundBuyer), "Refund transfer failed");
        }

        emit JobResolved(_jobId, payoutWorker, refundBuyer, _elapsedTime, finalStatus);
    }

    function getRegisteredAgents() external view returns (address[] memory) {
        return registeredAgents;
    }
}
