// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ReplyBond
 * @notice A provider posts a penalty bond for a pay-per-job agreement. A buyer
 * accepts by funding the price, and the provider must publish an answer onchain
 * before the deadline. An open offer can be accepted by anyone.
 * @dev Amounts are 18-decimal native USDC on Arc: 1 USDC = 1e18 wei-units here;
 * the ERC-20 view of the same funds has 6 decimals. No ERC-20 transfers are used.
 * Respond is allowed at or before the deadline; timeout is strictly after it.
 * Claim is strictly after respondedAt + graceWindow, including when grace is zero.
 * Outputs are transaction calldata plus an event log, not stored output bytes.
 * MAX_OUTPUT bounds gas; demo outputs should be short.
 * A payee that rejects the transfer is credited to owed and can retry withdrawal.
 *
 * I1 conservation: contract balance >= totalLocked + totalOwed, with equality
 * unless someone force-sends native value. Logic never reads address(this).balance.
 * I2 single terminal: each job reaches exactly one of Paid, Claimed, TimedOut,
 * Withdrawn, once, when settled; a terminal job cannot transition again.
 * I3 no stranding: every non-terminal state has an exit: Open -> provider
 * withdrawOffer or buyer accept; Accepted -> provider respond before (or at) the
 * deadline or anyone timeout after it; Responded -> buyer acknowledge or anyone
 * claim after the grace window. Failed payouts are withdrawable via withdrawOwed.
 * I4 payout sum: a settlement pays out exactly price + bond to exactly one payee;
 * withdrawOffer pays exactly the bond. Failed sends preserve that amount as owed.
 * I5 role gates: only the provider can withdrawOffer or respond; only the buyer
 * can acknowledge; only the designated buyer can accept a restricted offer.
 * I6 delivery evidence: Paid/Claimed are only reachable through Responded, which
 * requires an on-time respond that emitted ResponseCommitted with output and
 * keccak256(output).
 *
 * The contract proves the output was delivered onchain on time; it does not prove the output is correct, and outputs are public.
 */
contract ReplyBond is ReentrancyGuard {
    enum Status {
        Open,
        Accepted,
        Responded,
        Paid,
        Claimed,
        TimedOut,
        Withdrawn
    }

    struct Job {
        address provider;
        address buyer;
        uint256 price;
        uint256 bond;
        bytes32 requestHash;
        uint64 responseWindow;
        uint64 graceWindow;
        uint64 deadline;
        uint64 respondedAt;
        bytes32 responseHash;
        Status status;
    }

    uint256 public constant MAX_OUTPUT = 1024;
    uint256 public constant PAYOUT_GAS = 100_000;
    uint256 public nextJobId = 1;
    uint256 public totalLocked;
    uint256 public totalOwed;
    mapping(address => uint256) public owed;
    mapping(uint256 => Job) private _jobs;

    error UnknownJob(uint256 id);
    error WrongStatus(uint256 id, Status expected, Status actual);
    error NotProvider(uint256 id);
    error NotBuyer(uint256 id);
    error InvalidBond();
    error InvalidPrice();
    error InvalidResponseWindow();
    error IncorrectPayment(uint256 expected, uint256 actual);
    error DeadlineOverflow();
    error ResponseDeadlinePassed(uint256 id);
    error DeadlineNotPassed(uint256 id);
    error GraceWindowNotPassed(uint256 id);
    error InvalidOutputLength(uint256 length);
    error NothingOwed();
    error OwedTransferFailed();

    event OfferPosted(
        uint256 indexed id,
        address indexed provider,
        address indexed buyer,
        bytes32 requestHash,
        uint256 price,
        uint256 bond,
        uint64 responseWindow,
        uint64 graceWindow
    );
    event OfferWithdrawn(uint256 indexed id, address indexed provider, uint256 bond);
    event OfferAccepted(uint256 indexed id, address indexed buyer, uint64 deadline);
    event ResponseCommitted(
        uint256 indexed id, bytes32 indexed responseHash, bytes output, uint64 respondedAt
    );
    event JobPaid(uint256 indexed id, address indexed provider, uint256 amount);
    event JobClaimed(uint256 indexed id, address indexed provider, address indexed caller, uint256 amount);
    event JobTimedOut(uint256 indexed id, address indexed buyer, address indexed caller, uint256 amount);
    event PayoutOwed(uint256 indexed id, address indexed payee, uint256 amount);
    event OwedWithdrawn(address indexed payee, uint256 amount);

    /// @notice Returns an existing job; nonexistent ids revert rather than reading as Open.
    function getJob(uint256 id) external view returns (Job memory) {
        return _requireJob(id);
    }

    function postOffer(
        bytes32 requestHash,
        address buyer,
        uint256 price,
        uint64 responseWindow,
        uint64 graceWindow
    ) external payable nonReentrant returns (uint256 id) {
        if (msg.value == 0) revert InvalidBond();
        if (price == 0) revert InvalidPrice();
        if (responseWindow == 0) revert InvalidResponseWindow();

        id = nextJobId++;
        _jobs[id] = Job({
            provider: msg.sender,
            buyer: buyer,
            price: price,
            bond: msg.value,
            requestHash: requestHash,
            responseWindow: responseWindow,
            graceWindow: graceWindow,
            deadline: 0,
            respondedAt: 0,
            responseHash: bytes32(0),
            status: Status.Open
        });
        totalLocked += msg.value;
        emit OfferPosted(id, msg.sender, buyer, requestHash, price, msg.value, responseWindow, graceWindow);
    }

    function withdrawOffer(uint256 id) external nonReentrant {
        Job storage job = _requireJob(id);
        if (msg.sender != job.provider) revert NotProvider(id);
        _requireStatus(id, job, Status.Open);

        job.status = Status.Withdrawn;
        emit OfferWithdrawn(id, job.provider, job.bond);
        _pay(id, job.provider, job.bond);
    }

    function acceptOffer(uint256 id) external payable nonReentrant {
        Job storage job = _requireJob(id);
        _requireStatus(id, job, Status.Open);
        if (job.buyer != address(0) && msg.sender != job.buyer) revert NotBuyer(id);
        if (msg.value != job.price) revert IncorrectPayment(job.price, msg.value);

        // Check before addition so even an extreme timestamp uses the custom error.
        if (block.timestamp > uint256(type(uint64).max) - uint256(job.responseWindow)) {
            revert DeadlineOverflow();
        }
        uint256 deadline = block.timestamp + uint256(job.responseWindow);
        job.buyer = msg.sender;
        job.deadline = uint64(deadline);
        job.status = Status.Accepted;
        totalLocked += msg.value;
        emit OfferAccepted(id, msg.sender, job.deadline);
    }

    function respond(uint256 id, bytes calldata output) external nonReentrant {
        Job storage job = _requireJob(id);
        if (msg.sender != job.provider) revert NotProvider(id);
        _requireStatus(id, job, Status.Accepted);
        if (block.timestamp > uint256(job.deadline)) revert ResponseDeadlinePassed(id);
        if (output.length == 0 || output.length > MAX_OUTPUT) revert InvalidOutputLength(output.length);

        // An on-time timestamp fits uint64 because the stored deadline fits uint64.
        job.responseHash = keccak256(output);
        job.respondedAt = uint64(block.timestamp);
        job.status = Status.Responded;
        emit ResponseCommitted(id, job.responseHash, output, job.respondedAt);
    }

    function acknowledge(uint256 id) external nonReentrant {
        Job storage job = _requireJob(id);
        if (msg.sender != job.buyer) revert NotBuyer(id);
        _requireStatus(id, job, Status.Responded);

        uint256 amount = job.price + job.bond;
        job.status = Status.Paid;
        emit JobPaid(id, job.provider, amount);
        _pay(id, job.provider, amount);
    }

    function claim(uint256 id) external nonReentrant {
        Job storage job = _requireJob(id);
        _requireStatus(id, job, Status.Responded);
        if (block.timestamp <= uint256(job.respondedAt) + uint256(job.graceWindow)) {
            revert GraceWindowNotPassed(id);
        }

        uint256 amount = job.price + job.bond;
        job.status = Status.Claimed;
        emit JobClaimed(id, job.provider, msg.sender, amount);
        _pay(id, job.provider, amount);
    }

    function timeout(uint256 id) external nonReentrant {
        Job storage job = _requireJob(id);
        _requireStatus(id, job, Status.Accepted);
        if (block.timestamp <= uint256(job.deadline)) revert DeadlineNotPassed(id);

        uint256 amount = job.price + job.bond;
        job.status = Status.TimedOut;
        emit JobTimedOut(id, job.buyer, msg.sender, amount);
        _pay(id, job.buyer, amount);
    }

    function withdrawOwed() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();

        owed[msg.sender] = 0;
        totalOwed -= amount;
        if (!_sendNative(msg.sender, amount)) revert OwedTransferFailed();
        emit OwedWithdrawn(msg.sender, amount);
    }

    function _requireJob(uint256 id) internal view returns (Job storage job) {
        job = _jobs[id];
        if (job.provider == address(0)) revert UnknownJob(id);
    }

    function _requireStatus(uint256 id, Job storage job, Status expected) internal view {
        if (job.status != expected) revert WrongStatus(id, expected, job.status);
    }

    function _pay(uint256 id, address payee, uint256 amount) internal {
        totalLocked -= amount;
        if (!_sendNative(payee, amount)) {
            // A failed CALL transfers no value. Record the fallback liability;
            // all entry points remain guarded during the attempted interaction.
            owed[payee] += amount;
            totalOwed += amount;
            emit PayoutOwed(id, payee, amount);
        }
    }

    /// @dev Bounded gas and zero-length return area: never copies returndata.
    function _sendNative(address payee, uint256 amount) private returns (bool success) {
        assembly ("memory-safe") {
            success := call(PAYOUT_GAS, payee, amount, 0, 0, 0, 0)
        }
    }
}
