// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReplyBond} from "../ReplyBond.sol";

// ───────────────────────── helper payees ─────────────────────────

/// Provider contract with a toggleable receive(): rejects native transfers while `accepting == false`.
contract RejectingProvider {
    ReplyBond public rb;
    bool public accepting;
    uint256 public received;

    constructor(ReplyBond _rb) {
        rb = _rb;
    }

    function setAccepting(bool a) external {
        accepting = a;
    }

    function post(bytes32 req, address buyer, uint256 price, uint64 rw, uint64 gw)
        external
        payable
        returns (uint256)
    {
        return rb.postOffer{value: msg.value}(req, buyer, price, rw, gw);
    }

    function respond(uint256 id, bytes calldata out) external {
        rb.respond(id, out);
    }

    function withdrawOffer(uint256 id) external {
        rb.withdrawOffer(id);
    }

    function withdrawOwed() external {
        rb.withdrawOwed();
    }

    receive() external payable {
        if (!accepting) revert("rejecting");
        received += msg.value;
    }
}

/// Buyer contract with a toggleable receive().
contract RejectingBuyer {
    ReplyBond public rb;
    bool public accepting;
    uint256 public received;

    constructor(ReplyBond _rb) {
        rb = _rb;
    }

    function setAccepting(bool a) external {
        accepting = a;
    }

    function accept(uint256 id) external payable {
        rb.acceptOffer{value: msg.value}(id);
    }

    function acknowledge(uint256 id) external {
        rb.acknowledge(id);
    }

    function withdrawOwed() external {
        rb.withdrawOwed();
    }

    receive() external payable {
        if (!accepting) revert("rejecting");
        received += msg.value;
    }
}

/// Payee that can be provider or buyer and misbehaves inside receive() according to `mode`.
contract ReentrantPayee {
    enum Mode {
        Accept,
        Reject,
        BurnGas,
        ReenterClaim,
        ReenterWithdrawOwed,
        ReenterPost,
        ReenterClaimPropagate
    }

    ReplyBond public rb;
    Mode public mode;
    uint256 public targetId;
    uint256 public blocked;
    bool public reentered;
    bytes4 public lastRevert;
    uint256 public received;
    uint256 public spin;

    constructor(ReplyBond _rb) {
        rb = _rb;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    function setTarget(uint256 id) external {
        targetId = id;
    }

    function post(bytes32 req, address buyer, uint256 price, uint64 rw, uint64 gw)
        external
        payable
        returns (uint256)
    {
        return rb.postOffer{value: msg.value}(req, buyer, price, rw, gw);
    }

    function respond(uint256 id, bytes calldata out) external {
        rb.respond(id, out);
    }

    function accept(uint256 id) external payable {
        rb.acceptOffer{value: msg.value}(id);
    }

    function withdrawOwed() external {
        rb.withdrawOwed();
    }

    receive() external payable {
        Mode m = mode;
        if (m == Mode.Reject) revert("rejecting");
        if (m == Mode.BurnGas) {
            while (spin < type(uint256).max) {
                spin++;
            }
        }
        if (m == Mode.ReenterClaim) {
            try rb.claim(targetId) {
                reentered = true;
            } catch (bytes memory r) {
                blocked++;
                lastRevert = bytes4(r);
            }
        } else if (m == Mode.ReenterWithdrawOwed) {
            try rb.withdrawOwed() {
                reentered = true;
            } catch (bytes memory r) {
                blocked++;
                lastRevert = bytes4(r);
            }
        } else if (m == Mode.ReenterPost) {
            try rb.postOffer{value: 1}(bytes32(0), address(0), 1, 1, 0) {
                reentered = true;
            } catch (bytes memory r) {
                blocked++;
                lastRevert = bytes4(r);
            }
        } else if (m == Mode.ReenterClaimPropagate) {
            rb.claim(targetId); // revert bubbles up -> transfer fails
        }
        received += msg.value;
    }
}

// ───────────────────────── main test suite ─────────────────────────

contract ReplyBondTest is Test {
    ReplyBond internal rb;

    address internal provider = makeAddr("provider");
    address internal buyer = makeAddr("buyer");
    address internal other = makeAddr("other");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant PRICE = 1e18;
    uint256 internal constant BOND = 2e18;
    uint64 internal constant RW = 100;
    uint64 internal constant GW = 50;
    bytes32 internal constant REQ = keccak256("request");

    // Test vectors (computed with `cast keccak "<string>"`).
    string internal constant S_INVOICE = "invoice #4471 is ready for review";
    string internal constant S_SUMMARISE = "summarise: q3 vendor contract";
    bytes32 internal constant H_INVOICE = 0x7d43cb7cf12f8ae72119ab31a72c43c76a0a0a20a7539b566ab40d38e4e36299;
    bytes32 internal constant H_SUMMARISE = 0x2349bb5ca916e84effd0922e6989818c3307763aba9615435f5a0fa8e5d8d662;

    ReplyBond.Status internal constant OPEN = ReplyBond.Status.Open;
    ReplyBond.Status internal constant ACCEPTED = ReplyBond.Status.Accepted;
    ReplyBond.Status internal constant RESPONDED = ReplyBond.Status.Responded;

    address[] internal watched; // addresses whose `owed` is summed in assertConserved

    function setUp() public virtual {
        vm.warp(1000);
        rb = new ReplyBond();
        address[4] memory a = [provider, buyer, other, stranger];
        for (uint256 i; i < a.length; i++) {
            vm.deal(a[i], 1_000e18);
            watched.push(a[i]);
        }
    }

    // ───────── helpers ─────────

    /// I1: balance == totalLocked + totalOwed, and locked funds recomputed from getJob over all ids.
    function assertConserved() internal view {
        assertEq(address(rb).balance, rb.totalLocked() + rb.totalOwed(), "balance != locked+owed");
        uint256 locked;
        uint256 n = rb.nextJobId();
        for (uint256 id = 1; id < n; id++) {
            ReplyBond.Job memory j = rb.getJob(id);
            if (j.status == ReplyBond.Status.Open) locked += j.bond;
            else if (j.status == ReplyBond.Status.Accepted || j.status == ReplyBond.Status.Responded) {
                locked += j.price + j.bond;
            }
        }
        assertEq(locked, rb.totalLocked(), "recomputed locked != totalLocked");
        uint256 owedSum;
        for (uint256 i; i < watched.length; i++) {
            owedSum += rb.owed(watched[i]);
        }
        assertEq(owedSum, rb.totalOwed(), "sum(owed) != totalOwed");
    }

    function _post(address buyer_) internal returns (uint256 id) {
        return _postFull(buyer_, GW);
    }

    function _postFull(address buyer_, uint64 gw) internal returns (uint256 id) {
        vm.prank(provider);
        id = rb.postOffer{value: BOND}(REQ, buyer_, PRICE, RW, gw);
        assertConserved();
    }

    function _accept(uint256 id, address by) internal {
        vm.prank(by);
        rb.acceptOffer{value: PRICE}(id);
        assertConserved();
    }

    function _respond(uint256 id, bytes memory out) internal {
        vm.prank(provider);
        rb.respond(id, out);
        assertConserved();
    }

    /// Posted (designated to `buyer`) and accepted. Status Accepted.
    function _accepted() internal returns (uint256 id) {
        id = _post(buyer);
        _accept(id, buyer);
    }

    /// Accepted and responded with "hello". Status Responded.
    function _responded() internal returns (uint256 id) {
        id = _accepted();
        _respond(id, bytes("hello"));
    }

    function _deadline(uint256 id) internal view returns (uint64) {
        return rb.getJob(id).deadline;
    }

    function _status(uint256 id) internal view returns (ReplyBond.Status) {
        return rb.getJob(id).status;
    }

    function _wrong(uint256 id, ReplyBond.Status expected, ReplyBond.Status actual) internal {
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.WrongStatus.selector, id, expected, actual));
    }

    /// I2: every state-changing call on a terminal id reverts and nothing changes.
    function _assertFrozen(uint256 id) internal {
        ReplyBond.Job memory j = rb.getJob(id);
        ReplyBond.Status s = j.status;
        assertTrue(s >= ReplyBond.Status.Paid, "not terminal");
        uint256 t = block.timestamp;
        vm.warp(t + 10_000);
        address b = j.buyer == address(0) ? other : j.buyer;
        uint256 bal = address(rb).balance;
        uint256 locked = rb.totalLocked();
        uint256 owedTotal = rb.totalOwed();

        vm.prank(j.provider);
        _wrong(id, OPEN, s);
        rb.withdrawOffer(id);

        vm.deal(b, b.balance + j.price);
        vm.prank(b);
        _wrong(id, OPEN, s);
        rb.acceptOffer{value: j.price}(id);

        vm.prank(j.provider);
        _wrong(id, ACCEPTED, s);
        rb.respond(id, bytes("x"));

        vm.prank(b);
        if (j.buyer == address(0)) vm.expectRevert(abi.encodeWithSelector(ReplyBond.NotBuyer.selector, id));
        else _wrong(id, RESPONDED, s);
        rb.acknowledge(id);

        vm.prank(stranger);
        _wrong(id, RESPONDED, s);
        rb.claim(id);

        vm.prank(stranger);
        _wrong(id, ACCEPTED, s);
        rb.timeout(id);

        vm.warp(t);
        assertTrue(rb.getJob(id).status == s, "terminal status changed");
        assertEq(address(rb).balance, bal);
        assertEq(rb.totalLocked(), locked);
        assertEq(rb.totalOwed(), owedTotal);
        assertConserved();
    }

    // ───────── 1. happy path ─────────

    function test_HappyPath_AcknowledgePaysProviderPriceAndBond() public {
        uint256 pBefore = provider.balance;

        vm.expectEmit(true, true, true, true, address(rb));
        emit ReplyBond.OfferPosted(1, provider, buyer, REQ, PRICE, BOND, RW, GW);
        uint256 id = _post(buyer);
        assertEq(id, 1);
        assertEq(provider.balance, pBefore - BOND);
        assertTrue(_status(id) == OPEN);
        assertEq(rb.totalLocked(), BOND);

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.OfferAccepted(id, buyer, uint64(block.timestamp) + RW);
        _accept(id, buyer);
        assertTrue(_status(id) == ACCEPTED);
        assertEq(_deadline(id), uint64(block.timestamp) + RW);
        assertEq(rb.totalLocked(), PRICE + BOND);

        _respond(id, bytes("hello"));
        assertTrue(_status(id) == RESPONDED);

        uint256 before = provider.balance;
        uint256 contractBefore = address(rb).balance;
        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.JobPaid(id, provider, PRICE + BOND);
        vm.prank(buyer);
        rb.acknowledge(id);

        assertEq(provider.balance - before, PRICE + BOND, "I4: provider delta");
        assertEq(contractBefore - address(rb).balance, PRICE + BOND, "I4: contract delta");
        assertTrue(_status(id) == ReplyBond.Status.Paid);
        assertEq(rb.totalLocked(), 0);
        assertEq(rb.totalOwed(), 0);
        assertConserved();
        _assertFrozen(id);
    }

    // ───────── 2. timeout / deadline boundaries ─────────

    function test_Timeout_AfterDeadline_PaysBuyerPriceAndBond() public {
        uint256 id = _accepted();
        vm.warp(_deadline(id) + 1);
        uint256 before = buyer.balance;

        vm.expectEmit(true, true, true, true, address(rb));
        emit ReplyBond.JobTimedOut(id, buyer, stranger, PRICE + BOND);
        vm.prank(stranger);
        rb.timeout(id);

        assertEq(buyer.balance - before, PRICE + BOND, "I4: buyer delta");
        assertTrue(_status(id) == ReplyBond.Status.TimedOut);
        assertEq(rb.totalLocked(), 0);
        assertConserved();
        _assertFrozen(id);
    }

    function test_Timeout_AtExactlyDeadline_Reverts() public {
        uint256 id = _accepted();
        vm.warp(_deadline(id));
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.DeadlineNotPassed.selector, id));
        rb.timeout(id);
        assertTrue(_status(id) == ACCEPTED);
        assertConserved();
    }

    function test_Timeout_BeforeDeadline_Reverts() public {
        uint256 id = _accepted();
        vm.warp(_deadline(id) - 1);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.DeadlineNotPassed.selector, id));
        rb.timeout(id);
        // immediately after acceptance too
        vm.warp(_deadline(id) - RW);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.DeadlineNotPassed.selector, id));
        rb.timeout(id);
        assertConserved();
    }

    function test_Respond_AtExactlyDeadline_Succeeds() public {
        uint256 id = _accepted();
        vm.warp(_deadline(id));
        _respond(id, bytes("on time"));
        assertTrue(_status(id) == RESPONDED);
        assertEq(rb.getJob(id).respondedAt, _deadline(id));
        // and timeout is no longer possible (WrongStatus)
        vm.warp(_deadline(id) + 1);
        _wrong(id, ACCEPTED, RESPONDED);
        rb.timeout(id);
        assertConserved();
    }

    // ───────── 3. late respond ─────────

    function test_Respond_AfterDeadline_Reverts() public {
        uint256 id = _accepted();
        vm.warp(_deadline(id) + 1);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.ResponseDeadlinePassed.selector, id));
        rb.respond(id, bytes("late"));
        assertTrue(_status(id) == ACCEPTED);
        assertConserved();
    }

    // ───────── 4. output length ─────────

    function test_Respond_EmptyOutput_Reverts() public {
        uint256 id = _accepted();
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.InvalidOutputLength.selector, 0));
        rb.respond(id, "");
        assertTrue(_status(id) == ACCEPTED);
        assertConserved();
    }

    function test_Respond_1025Bytes_Reverts() public {
        uint256 id = _accepted();
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.InvalidOutputLength.selector, 1025));
        rb.respond(id, new bytes(1025));
        assertTrue(_status(id) == ACCEPTED);
        assertConserved();
    }

    function test_Respond_Exactly1024Bytes_Succeeds() public {
        uint256 id = _accepted();
        bytes memory out = new bytes(1024);
        out[0] = 0xAA;
        out[1023] = 0xBB;
        _respond(id, out);
        assertTrue(_status(id) == RESPONDED);
        assertEq(rb.getJob(id).responseHash, keccak256(out));
        assertEq(rb.MAX_OUTPUT(), 1024);
    }

    function test_Respond_1Byte_Succeeds() public {
        uint256 id = _accepted();
        _respond(id, hex"01");
        assertTrue(_status(id) == RESPONDED);
    }

    // ───────── 5. ResponseCommitted ─────────

    function test_Respond_EmitsResponseCommittedAndStoresHash() public {
        uint256 id = _accepted();
        bytes memory out = bytes("the answer is 42");
        vm.warp(block.timestamp + 7);

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.ResponseCommitted(id, keccak256(out), out, uint64(block.timestamp));
        _respond(id, out);

        ReplyBond.Job memory j = rb.getJob(id);
        assertEq(j.responseHash, keccak256(out));
        assertEq(j.respondedAt, uint64(block.timestamp));
        assertTrue(j.status == RESPONDED);
    }

    // ───────── 6. buyer withholds acknowledge → claim ─────────

    function test_Claim_AfterGraceWindow_PaysProvider() public {
        uint256 id = _responded();
        uint64 respondedAt = rb.getJob(id).respondedAt;
        vm.warp(respondedAt + GW + 1);
        uint256 before = provider.balance;

        vm.expectEmit(true, true, true, true, address(rb));
        emit ReplyBond.JobClaimed(id, provider, stranger, PRICE + BOND);
        vm.prank(stranger);
        rb.claim(id);

        assertEq(provider.balance - before, PRICE + BOND, "I4: provider delta");
        assertTrue(_status(id) == ReplyBond.Status.Claimed);
        assertEq(rb.totalLocked(), 0);
        assertConserved();
        _assertFrozen(id);
    }

    function test_Claim_BeforeGraceWindow_Reverts() public {
        uint256 id = _responded();
        uint64 respondedAt = rb.getJob(id).respondedAt;
        vm.warp(respondedAt + 1);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.GraceWindowNotPassed.selector, id));
        rb.claim(id);
        vm.warp(respondedAt + GW - 1);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.GraceWindowNotPassed.selector, id));
        rb.claim(id);
        assertTrue(_status(id) == RESPONDED);
        assertConserved();
    }

    function test_Claim_AtExactlyGraceBoundary_Reverts() public {
        uint256 id = _responded();
        uint64 respondedAt = rb.getJob(id).respondedAt;
        vm.warp(respondedAt + GW);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.GraceWindowNotPassed.selector, id));
        rb.claim(id);
        assertTrue(_status(id) == RESPONDED);
        assertConserved();
    }

    function test_Claim_ZeroGrace_OnlyStrictlyAfterRespondedAt() public {
        uint256 id = _postFull(buyer, 0);
        _accept(id, buyer);
        _respond(id, bytes("hello"));
        uint64 respondedAt = rb.getJob(id).respondedAt;
        assertEq(uint256(block.timestamp), uint256(respondedAt));

        // same timestamp as respondedAt: reverts
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.GraceWindowNotPassed.selector, id));
        rb.claim(id);

        // strictly after: works
        vm.warp(respondedAt + 1);
        uint256 before = provider.balance;
        vm.prank(stranger);
        rb.claim(id);
        assertEq(provider.balance - before, PRICE + BOND);
        assertTrue(_status(id) == ReplyBond.Status.Claimed);
        assertConserved();
        _assertFrozen(id);
    }

    function test_Claim_BuyerCanStillAcknowledgeWithinGrace() public {
        uint256 id = _responded();
        uint256 before = provider.balance;
        vm.prank(buyer);
        rb.acknowledge(id);
        assertEq(provider.balance - before, PRICE + BOND);
        assertConserved();
    }

    // ───────── 7. double settlement ─────────

    function test_Double_AcknowledgeTwice_Reverts() public {
        uint256 id = _responded();
        vm.prank(buyer);
        rb.acknowledge(id);
        vm.prank(buyer);
        _wrong(id, RESPONDED, ReplyBond.Status.Paid);
        rb.acknowledge(id);
        assertTrue(_status(id) == ReplyBond.Status.Paid);
        assertConserved();
        _assertFrozen(id);
    }

    function test_Double_ClaimTwice_Reverts() public {
        uint256 id = _responded();
        vm.warp(block.timestamp + GW + 1);
        rb.claim(id);
        _wrong(id, RESPONDED, ReplyBond.Status.Claimed);
        rb.claim(id);
        assertTrue(_status(id) == ReplyBond.Status.Claimed);
        assertConserved();
        _assertFrozen(id);
    }

    function test_Double_AcknowledgeAfterClaim_Reverts() public {
        uint256 id = _responded();
        vm.warp(block.timestamp + GW + 1);
        rb.claim(id);
        vm.prank(buyer);
        _wrong(id, RESPONDED, ReplyBond.Status.Claimed);
        rb.acknowledge(id);
        assertTrue(_status(id) == ReplyBond.Status.Claimed);
        assertConserved();
    }

    function test_Double_ClaimAfterAcknowledge_Reverts() public {
        uint256 id = _responded();
        vm.prank(buyer);
        rb.acknowledge(id);
        vm.warp(block.timestamp + GW + 1);
        _wrong(id, RESPONDED, ReplyBond.Status.Paid);
        rb.claim(id);
        assertTrue(_status(id) == ReplyBond.Status.Paid);
        assertConserved();
    }

    function test_Double_TimeoutAfterTimeout_Reverts() public {
        uint256 id = _accepted();
        vm.warp(_deadline(id) + 1);
        rb.timeout(id);
        _wrong(id, ACCEPTED, ReplyBond.Status.TimedOut);
        rb.timeout(id);
        assertTrue(_status(id) == ReplyBond.Status.TimedOut);
        assertConserved();
    }

    function test_Double_RespondAfterTimeout_Reverts() public {
        uint256 id = _accepted();
        vm.warp(_deadline(id) + 1);
        rb.timeout(id);
        vm.prank(provider);
        _wrong(id, ACCEPTED, ReplyBond.Status.TimedOut);
        rb.respond(id, bytes("too late"));
        assertTrue(_status(id) == ReplyBond.Status.TimedOut);
        assertConserved();
        _assertFrozen(id);
    }

    function test_Double_TimeoutAfterRespond_Reverts() public {
        uint256 id = _responded();
        vm.warp(_deadline(id) + 1);
        _wrong(id, ACCEPTED, RESPONDED);
        rb.timeout(id);
        assertTrue(_status(id) == RESPONDED);
        assertConserved();
    }

    function test_Double_AcknowledgeBeforeRespond_Reverts() public {
        uint256 id = _accepted();
        vm.prank(buyer);
        _wrong(id, RESPONDED, ACCEPTED);
        rb.acknowledge(id);
        _wrong(id, RESPONDED, ACCEPTED);
        rb.claim(id);
        assertTrue(_status(id) == ACCEPTED);
        assertConserved();
    }

    function test_Double_AcknowledgeOrClaimOnOpenJob_Reverts() public {
        uint256 id = _post(buyer);
        vm.prank(buyer);
        _wrong(id, RESPONDED, OPEN);
        rb.acknowledge(id);
        _wrong(id, RESPONDED, OPEN);
        rb.claim(id);
        _wrong(id, ACCEPTED, OPEN);
        rb.timeout(id);
        vm.prank(provider);
        _wrong(id, ACCEPTED, OPEN);
        rb.respond(id, bytes("x"));
        assertConserved();
    }

    // ───────── 8. role gates ─────────

    function test_Respond_OnlyProvider() public {
        uint256 id = _accepted();
        address[3] memory bad = [buyer, other, stranger];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(bad[i]);
            vm.expectRevert(abi.encodeWithSelector(ReplyBond.NotProvider.selector, id));
            rb.respond(id, bytes("hello"));
        }
        assertTrue(_status(id) == ACCEPTED);
        _respond(id, bytes("hello")); // provider succeeds
        assertTrue(_status(id) == RESPONDED);
    }

    function test_Acknowledge_OnlyBuyer() public {
        uint256 id = _responded();
        address[3] memory bad = [provider, other, stranger];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(bad[i]);
            vm.expectRevert(abi.encodeWithSelector(ReplyBond.NotBuyer.selector, id));
            rb.acknowledge(id);
        }
        assertTrue(_status(id) == RESPONDED);
        assertConserved();
    }

    function test_WithdrawOffer_OnlyProvider() public {
        uint256 id = _post(address(0));
        address[3] memory bad = [buyer, other, stranger];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(bad[i]);
            vm.expectRevert(abi.encodeWithSelector(ReplyBond.NotProvider.selector, id));
            rb.withdrawOffer(id);
        }
        assertTrue(_status(id) == OPEN);
        assertConserved();
    }

    // ───────── 9. accept gating and payment ─────────

    function test_Accept_DesignatedOffer_OtherAddressReverts() public {
        uint256 id = _post(buyer);
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.NotBuyer.selector, id));
        rb.acceptOffer{value: PRICE}(id);
        // provider can't accept their own designated offer either
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.NotBuyer.selector, id));
        rb.acceptOffer{value: PRICE}(id);
        assertTrue(_status(id) == OPEN);
        assertEq(rb.getJob(id).buyer, buyer);
        assertConserved();
        _accept(id, buyer); // the designated buyer succeeds
        assertTrue(_status(id) == ACCEPTED);
    }

    function test_Accept_OpenOffer_AnyoneCanAcceptAndBecomesBuyer() public {
        uint256 id = _post(address(0));
        assertEq(rb.getJob(id).buyer, address(0));
        _accept(id, other);
        assertEq(rb.getJob(id).buyer, other);
        assertTrue(_status(id) == ACCEPTED);

        // a different stranger accepts a different open offer
        uint256 id2 = _post(address(0));
        _accept(id2, stranger);
        assertEq(rb.getJob(id2).buyer, stranger);

        // the new buyer (not the original `buyer`) is the one who may acknowledge
        _respond(id, bytes("hello"));
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.NotBuyer.selector, id));
        rb.acknowledge(id);
        uint256 before = provider.balance;
        vm.prank(other);
        rb.acknowledge(id);
        assertEq(provider.balance - before, PRICE + BOND);
        assertConserved();
    }

    function test_Accept_WrongValue_Reverts() public {
        uint256 id = _post(buyer);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.IncorrectPayment.selector, PRICE, PRICE - 1));
        rb.acceptOffer{value: PRICE - 1}(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.IncorrectPayment.selector, PRICE, PRICE + 1));
        rb.acceptOffer{value: PRICE + 1}(id);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.IncorrectPayment.selector, PRICE, 0));
        rb.acceptOffer(id);
        assertTrue(_status(id) == OPEN);
        assertEq(rb.totalLocked(), BOND);
        assertConserved();
    }

    function test_Accept_DeadlineOverflow_Reverts() public {
        uint256 id = _post(buyer);
        vm.warp(uint256(type(uint64).max) - RW + 1);
        vm.prank(buyer);
        vm.expectRevert(ReplyBond.DeadlineOverflow.selector);
        rb.acceptOffer{value: PRICE}(id);
        vm.warp(uint256(type(uint64).max) - RW);
        _accept(id, buyer);
        assertEq(uint256(_deadline(id)), uint256(type(uint64).max));
    }

    function test_Accept_AlreadyAccepted_Reverts() public {
        uint256 id = _post(address(0));
        _accept(id, other);
        vm.prank(stranger);
        _wrong(id, OPEN, ACCEPTED);
        rb.acceptOffer{value: PRICE}(id);
        assertEq(rb.getJob(id).buyer, other);
        assertConserved();
    }

    // ───────── 10. withdrawOffer, unknown ids, postOffer validation ─────────

    function test_WithdrawOffer_ReturnsBond() public {
        uint256 id = _post(buyer);
        uint256 before = provider.balance;
        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.OfferWithdrawn(id, provider, BOND);
        vm.prank(provider);
        rb.withdrawOffer(id);
        assertEq(provider.balance - before, BOND, "I4: bond returned exactly");
        assertTrue(_status(id) == ReplyBond.Status.Withdrawn);
        assertEq(rb.totalLocked(), 0);
        assertEq(address(rb).balance, 0);
        assertConserved();
        _assertFrozen(id);
    }

    function test_WithdrawOffer_AfterAccept_Reverts() public {
        uint256 id = _accepted();
        vm.prank(provider);
        _wrong(id, OPEN, ACCEPTED);
        rb.withdrawOffer(id);
        assertEq(rb.totalLocked(), PRICE + BOND);
        assertConserved();
    }

    function test_WithdrawOffer_AfterWithdraw_Reverts() public {
        uint256 id = _post(address(0));
        vm.prank(provider);
        rb.withdrawOffer(id);
        vm.prank(provider);
        _wrong(id, OPEN, ReplyBond.Status.Withdrawn);
        rb.withdrawOffer(id);
        assertConserved();
    }

    function test_Accept_AfterWithdraw_Reverts() public {
        uint256 id = _post(address(0));
        vm.prank(provider);
        rb.withdrawOffer(id);
        vm.prank(other);
        _wrong(id, OPEN, ReplyBond.Status.Withdrawn);
        rb.acceptOffer{value: PRICE}(id);
        assertEq(address(rb).balance, 0);
        assertConserved();
    }

    function test_UnknownJob_RevertsOnEveryFunction() public {
        _post(buyer); // id 1 exists; 0 and 2.. do not
        uint256[3] memory ids = [uint256(0), 2, type(uint256).max];
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            bytes memory err = abi.encodeWithSelector(ReplyBond.UnknownJob.selector, id);
            vm.expectRevert(err);
            rb.getJob(id);
            vm.prank(provider);
            vm.expectRevert(err);
            rb.withdrawOffer(id);
            vm.prank(buyer);
            vm.expectRevert(err);
            rb.acceptOffer{value: PRICE}(id);
            vm.prank(provider);
            vm.expectRevert(err);
            rb.respond(id, bytes("x"));
            vm.prank(buyer);
            vm.expectRevert(err);
            rb.acknowledge(id);
            vm.expectRevert(err);
            rb.claim(id);
            vm.expectRevert(err);
            rb.timeout(id);
        }
        assertConserved();
    }

    function test_PostOffer_InvalidParams_Revert() public {
        vm.prank(provider);
        vm.expectRevert(ReplyBond.InvalidBond.selector);
        rb.postOffer(REQ, buyer, PRICE, RW, GW); // zero bond

        vm.prank(provider);
        vm.expectRevert(ReplyBond.InvalidPrice.selector);
        rb.postOffer{value: BOND}(REQ, buyer, 0, RW, GW);

        vm.prank(provider);
        vm.expectRevert(ReplyBond.InvalidResponseWindow.selector);
        rb.postOffer{value: BOND}(REQ, buyer, PRICE, 0, GW);

        assertEq(rb.nextJobId(), 1);
        assertEq(address(rb).balance, 0);
        assertConserved();
    }

    function test_PostOffer_IdsIncrementAndStoresParams() public {
        uint256 a = _post(buyer);
        uint256 b = _post(address(0));
        assertEq(a, 1);
        assertEq(b, 2);
        ReplyBond.Job memory j = rb.getJob(a);
        assertEq(j.provider, provider);
        assertEq(j.buyer, buyer);
        assertEq(j.price, PRICE);
        assertEq(j.bond, BOND);
        assertEq(j.requestHash, REQ);
        assertEq(j.responseWindow, RW);
        assertEq(j.graceWindow, GW);
        assertEq(rb.totalLocked(), 2 * BOND);
    }

    // ───────── 11. payees that reject / burn gas / reenter ─────────

    function _toggleAccepting(address payee, bool a) internal {
        (bool ok,) = payee.call(abi.encodeWithSignature("setAccepting(bool)", a));
        require(ok, "toggle failed");
    }

    /// owed[payee] == amt and rejecting: withdraw fails, then succeeds after toggling; then NothingOwed.
    function _withdrawOwedFlow(address payee, uint256 amt) internal {
        uint256 totBefore = rb.totalOwed();
        assertEq(rb.owed(payee), amt);

        vm.prank(payee);
        vm.expectRevert(ReplyBond.OwedTransferFailed.selector);
        rb.withdrawOwed();
        assertEq(rb.owed(payee), amt, "owed must survive failed withdraw");
        assertEq(rb.totalOwed(), totBefore);
        assertConserved();

        _toggleAccepting(payee, true);
        uint256 bal = payee.balance;
        vm.expectEmit(true, false, false, true, address(rb));
        emit ReplyBond.OwedWithdrawn(payee, amt);
        vm.prank(payee);
        rb.withdrawOwed();
        assertEq(payee.balance - bal, amt, "I4: exact owed paid");
        assertEq(rb.owed(payee), 0);
        assertEq(rb.totalOwed(), totBefore - amt);
        assertConserved();

        vm.prank(payee);
        vm.expectRevert(ReplyBond.NothingOwed.selector);
        rb.withdrawOwed();
        assertConserved();
    }

    function _newRP() internal returns (RejectingProvider rp) {
        rp = new RejectingProvider(rb);
        vm.deal(address(rp), 100e18);
        watched.push(address(rp));
    }

    function _newRBuyer() internal returns (RejectingBuyer rbuy) {
        rbuy = new RejectingBuyer(rb);
        vm.deal(address(rbuy), 100e18);
        watched.push(address(rbuy));
    }

    function _rpResponded(RejectingProvider rp) internal returns (uint256 id) {
        id = rp.post{value: BOND}(REQ, buyer, PRICE, RW, GW);
        _accept(id, buyer);
        rp.respond(id, bytes("hello"));
        assertConserved();
    }

    function test_RejectingProvider_Acknowledge_CreditsOwed() public {
        RejectingProvider rp = _newRP();
        uint256 id = _rpResponded(rp);
        uint256 id2 = _responded(); // an unrelated in-flight job
        uint256 amt = PRICE + BOND;

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.PayoutOwed(id, address(rp), amt);
        vm.prank(buyer);
        rb.acknowledge(id); // must NOT revert

        assertTrue(_status(id) == ReplyBond.Status.Paid);
        assertEq(rb.owed(address(rp)), amt);
        assertEq(rb.totalOwed(), amt);
        assertEq(address(rp).balance, 100e18, "no funds reached the rejecting payee");
        assertEq(rb.totalLocked(), amt, "only id2 still locked");
        assertConserved();

        // a different job still settles normally
        uint256 before = provider.balance;
        vm.prank(buyer);
        rb.acknowledge(id2);
        assertEq(provider.balance - before, amt);
        assertEq(rb.totalOwed(), amt);
        assertConserved();

        _withdrawOwedFlow(address(rp), amt);
        _assertFrozen(id);
    }

    function test_RejectingProvider_Claim_CreditsOwed() public {
        RejectingProvider rp = _newRP();
        uint256 id = _rpResponded(rp);
        uint256 amt = PRICE + BOND;
        vm.warp(block.timestamp + GW + 1);

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.PayoutOwed(id, address(rp), amt);
        vm.prank(stranger);
        rb.claim(id);

        assertTrue(_status(id) == ReplyBond.Status.Claimed);
        assertEq(rb.owed(address(rp)), amt);
        assertEq(rb.totalOwed(), amt);
        assertEq(rb.totalLocked(), 0);
        assertConserved();
        _withdrawOwedFlow(address(rp), amt);
        _assertFrozen(id);
    }

    function test_RejectingProvider_WithdrawOffer_BondCreditedAsOwed() public {
        RejectingProvider rp = _newRP();
        uint256 id = rp.post{value: BOND}(REQ, address(0), PRICE, RW, GW);
        assertConserved();
        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.PayoutOwed(id, address(rp), BOND);
        rp.withdrawOffer(id);
        assertTrue(_status(id) == ReplyBond.Status.Withdrawn);
        assertEq(rb.owed(address(rp)), BOND);
        assertEq(rb.totalOwed(), BOND);
        assertConserved();
        _withdrawOwedFlow(address(rp), BOND);
    }

    function test_RejectingBuyer_Timeout_CreditsOwed() public {
        RejectingBuyer rbuy = _newRBuyer();
        vm.prank(provider);
        uint256 id = rb.postOffer{value: BOND}(REQ, address(rbuy), PRICE, RW, GW);
        rbuy.accept{value: PRICE}(id);
        assertConserved();
        uint256 id2 = _accepted(); // unrelated job, will also time out
        uint256 amt = PRICE + BOND;
        vm.warp(_deadline(id2) + 1);

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.PayoutOwed(id, address(rbuy), amt);
        vm.prank(stranger);
        rb.timeout(id); // must NOT revert

        assertTrue(_status(id) == ReplyBond.Status.TimedOut);
        assertEq(rb.owed(address(rbuy)), amt);
        assertEq(rb.totalOwed(), amt);
        assertEq(rb.totalLocked(), amt, "only id2 still locked");
        assertConserved();

        uint256 before = buyer.balance;
        rb.timeout(id2); // different job settles normally
        assertEq(buyer.balance - before, amt);
        assertEq(rb.totalOwed(), amt);
        assertConserved();

        _withdrawOwedFlow(address(rbuy), amt);
        _assertFrozen(id);
    }

    function test_WithdrawOwed_NothingOwed_Reverts() public {
        vm.prank(provider);
        vm.expectRevert(ReplyBond.NothingOwed.selector);
        rb.withdrawOwed();
        assertConserved();
    }

    function test_BurnGasProvider_Acknowledge_DoesNotRevertAndCreditsOwed() public {
        ReentrantPayee p = new ReentrantPayee(rb);
        watched.push(address(p));
        vm.deal(address(p), 10e18);
        uint256 id = p.post{value: BOND}(REQ, buyer, PRICE, RW, GW);
        _accept(id, buyer);
        p.respond(id, bytes("hello"));
        p.setMode(ReentrantPayee.Mode.BurnGas);

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.PayoutOwed(id, address(p), PRICE + BOND);
        vm.prank(buyer);
        rb.acknowledge(id);

        assertTrue(_status(id) == ReplyBond.Status.Paid);
        assertEq(rb.owed(address(p)), PRICE + BOND);
        assertEq(rb.totalOwed(), PRICE + BOND);
        assertConserved();

        // after it stops burning gas, it can withdraw
        p.setMode(ReentrantPayee.Mode.Accept);
        uint256 bal = address(p).balance;
        vm.expectEmit(true, false, false, true, address(rb));
        emit ReplyBond.OwedWithdrawn(address(p), PRICE + BOND);
        p.withdrawOwed();
        assertEq(address(p).balance - bal, PRICE + BOND);
        assertEq(rb.totalOwed(), 0);
        assertConserved();
    }

    function test_BurnGasBuyer_Timeout_DoesNotRevertAndCreditsOwed() public {
        ReentrantPayee p = new ReentrantPayee(rb);
        watched.push(address(p));
        vm.deal(address(p), 10e18);
        vm.prank(provider);
        uint256 id = rb.postOffer{value: BOND}(REQ, address(p), PRICE, RW, GW);
        p.accept{value: PRICE}(id);
        p.setMode(ReentrantPayee.Mode.BurnGas);
        vm.warp(_deadline(id) + 1);

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.PayoutOwed(id, address(p), PRICE + BOND);
        rb.timeout(id);
        assertTrue(_status(id) == ReplyBond.Status.TimedOut);
        assertEq(rb.owed(address(p)), PRICE + BOND);
        assertEq(rb.totalOwed(), PRICE + BOND);
        assertConserved();
    }

    // ───────── reentrant payees ─────────

    function _reentrantProviderResponded(ReentrantPayee p) internal returns (uint256 id) {
        watched.push(address(p));
        vm.deal(address(p), 10e18);
        id = p.post{value: BOND}(REQ, buyer, PRICE, RW, GW);
        _accept(id, buyer);
        p.respond(id, bytes("hello"));
        p.setTarget(id);
        assertConserved();
    }

    /// Reentry attempt is swallowed by the payee: the guard blocks it and the payee is still paid.
    function _swallowCase(ReentrantPayee.Mode m, bool viaClaim) internal {
        ReentrantPayee p = new ReentrantPayee(rb);
        uint256 id = _reentrantProviderResponded(p);
        p.setMode(m);
        uint256 before = address(p).balance;
        uint256 amt = PRICE + BOND;

        if (viaClaim) {
            vm.warp(block.timestamp + GW + 1);
            vm.prank(stranger);
            rb.claim(id);
        } else {
            vm.prank(buyer);
            rb.acknowledge(id);
        }

        assertEq(address(p).balance - before, amt, "payee paid exactly price+bond");
        assertEq(p.blocked(), 1, "one reentry attempt blocked");
        assertFalse(p.reentered(), "reentry must not succeed");
        assertEq(p.lastRevert(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(rb.owed(address(p)), 0);
        assertEq(rb.totalOwed(), 0);
        assertEq(rb.totalLocked(), 0);
        assertEq(address(rb).balance, 0);
        assertTrue(_status(id) >= ReplyBond.Status.Paid);
        assertConserved();
        _assertFrozen(id);
    }

    function test_Reentrant_ReenterClaim_OnAcknowledge_Blocked() public {
        _swallowCase(ReentrantPayee.Mode.ReenterClaim, false);
    }

    function test_Reentrant_ReenterClaim_OnClaim_Blocked() public {
        _swallowCase(ReentrantPayee.Mode.ReenterClaim, true);
    }

    function test_Reentrant_ReenterWithdrawOwed_OnAcknowledge_Blocked() public {
        _swallowCase(ReentrantPayee.Mode.ReenterWithdrawOwed, false);
    }

    function test_Reentrant_ReenterWithdrawOwed_OnClaim_Blocked() public {
        _swallowCase(ReentrantPayee.Mode.ReenterWithdrawOwed, true);
    }

    function test_Reentrant_ReenterPostOffer_OnAcknowledge_Blocked() public {
        _swallowCase(ReentrantPayee.Mode.ReenterPost, false);
    }

    function test_Reentrant_ReenterPostOffer_OnClaim_Blocked() public {
        _swallowCase(ReentrantPayee.Mode.ReenterPost, true);
    }

    function test_Reentrant_PropagatingReentry_CreditsOwedWithoutRevert() public {
        ReentrantPayee p = new ReentrantPayee(rb);
        uint256 id = _reentrantProviderResponded(p);
        p.setMode(ReentrantPayee.Mode.ReenterClaimPropagate);
        uint256 amt = PRICE + BOND;

        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.PayoutOwed(id, address(p), amt);
        vm.prank(buyer);
        rb.acknowledge(id); // settlement must not revert

        assertTrue(_status(id) == ReplyBond.Status.Paid);
        assertEq(rb.owed(address(p)), amt);
        assertEq(rb.totalOwed(), amt);
        assertEq(rb.totalLocked(), 0);
        assertConserved();
    }

    function test_Reentrant_WithdrawOwedReentry_PaidOnlyOnce() public {
        ReentrantPayee p = new ReentrantPayee(rb);
        uint256 id = _reentrantProviderResponded(p);
        uint256 amt = PRICE + BOND;
        p.setMode(ReentrantPayee.Mode.Reject);
        vm.prank(buyer);
        rb.acknowledge(id);
        assertEq(rb.owed(address(p)), amt);

        // now it accepts but tries to reenter withdrawOwed during the payout
        p.setMode(ReentrantPayee.Mode.ReenterWithdrawOwed);
        uint256 before = address(p).balance;
        vm.expectEmit(true, false, false, true, address(rb));
        emit ReplyBond.OwedWithdrawn(address(p), amt);
        p.withdrawOwed();

        assertEq(address(p).balance - before, amt, "paid exactly once");
        assertEq(p.blocked(), 1);
        assertFalse(p.reentered());
        assertEq(p.lastRevert(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(rb.owed(address(p)), 0);
        assertEq(rb.totalOwed(), 0);
        assertEq(address(rb).balance, 0);
        assertConserved();
    }

    function test_Reentrant_BuyerReentersClaimOnTimeout_Blocked() public {
        ReentrantPayee p = new ReentrantPayee(rb);
        watched.push(address(p));
        vm.deal(address(p), 10e18);
        vm.prank(provider);
        uint256 id = rb.postOffer{value: BOND}(REQ, address(p), PRICE, RW, GW);
        p.accept{value: PRICE}(id);
        p.setTarget(id);
        p.setMode(ReentrantPayee.Mode.ReenterClaim);
        vm.warp(_deadline(id) + 1);
        uint256 before = address(p).balance;
        rb.timeout(id);
        assertEq(address(p).balance - before, PRICE + BOND);
        assertEq(p.blocked(), 1);
        assertEq(p.lastRevert(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(rb.totalOwed(), 0);
        assertConserved();
        _assertFrozen(id);
    }

    // ───────── fuzz ─────────

    function testFuzz_OutputLength(uint256 len) public {
        len = bound(len, 0, 3000);
        uint256 id = _accepted();
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; i++) {
            out[i] = bytes1(uint8(i));
        }
        vm.prank(provider);
        if (len == 0 || len > 1024) {
            vm.expectRevert(abi.encodeWithSelector(ReplyBond.InvalidOutputLength.selector, len));
            rb.respond(id, out);
            assertTrue(_status(id) == ACCEPTED);
        } else {
            rb.respond(id, out);
            assertTrue(_status(id) == RESPONDED);
            assertEq(rb.getJob(id).responseHash, keccak256(out));
        }
        assertConserved();
    }

    function testFuzz_AcknowledgePath(uint96 price, uint96 bond, uint32 rw, uint32 gw, uint32 offset) public {
        price = uint96(bound(price, 1, 1e24));
        bond = uint96(bound(bond, 1, 1e24));
        rw = uint32(bound(rw, 1, 1e6));
        gw = uint32(bound(gw, 0, 1e6));
        offset = uint32(bound(offset, 0, rw)); // respond anywhere in [accept, deadline]
        vm.deal(provider, 1e25);
        vm.deal(buyer, 1e25);

        vm.prank(provider);
        uint256 id = rb.postOffer{value: bond}(REQ, buyer, price, rw, gw);
        assertEq(rb.totalLocked(), bond);
        vm.prank(buyer);
        rb.acceptOffer{value: price}(id);
        assertEq(uint256(_deadline(id)), block.timestamp + rw);
        assertEq(rb.totalLocked(), uint256(price) + bond);
        assertConserved();

        vm.warp(block.timestamp + offset);
        _respond(id, bytes("ok"));

        uint256 before = provider.balance;
        vm.prank(buyer);
        rb.acknowledge(id);
        assertEq(provider.balance - before, uint256(price) + bond, "I4");
        assertEq(address(rb).balance, 0);
        assertConserved();
        _assertFrozen(id);
    }

    function testFuzz_ClaimBoundary(uint32 gw, uint32 extra) public {
        gw = uint32(bound(gw, 0, 1e6));
        extra = uint32(bound(extra, 0, 1e6));
        uint256 id = _postFull(buyer, gw);
        _accept(id, buyer);
        _respond(id, bytes("ok"));
        uint256 respondedAt = rb.getJob(id).respondedAt;

        // at or before respondedAt + gw: always reverts
        vm.warp(respondedAt + (extra % (uint256(gw) + 1)));
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.GraceWindowNotPassed.selector, id));
        rb.claim(id);

        // strictly after: pays provider price+bond
        vm.warp(respondedAt + gw + 1 + extra);
        uint256 before = provider.balance;
        rb.claim(id);
        assertEq(provider.balance - before, PRICE + BOND);
        assertConserved();
    }

    function testFuzz_TimeoutPath(uint96 price, uint96 bond, uint32 rw, uint32 late) public {
        price = uint96(bound(price, 1, 1e24));
        bond = uint96(bound(bond, 1, 1e24));
        rw = uint32(bound(rw, 1, 1e6));
        late = uint32(bound(late, 1, 1e6));
        vm.deal(provider, 1e25);
        vm.deal(other, 1e25);
        vm.prank(provider);
        uint256 id = rb.postOffer{value: bond}(REQ, address(0), price, rw, 0);
        vm.prank(other);
        rb.acceptOffer{value: price}(id);
        uint256 dl = _deadline(id);

        vm.warp(dl);
        vm.expectRevert(abi.encodeWithSelector(ReplyBond.DeadlineNotPassed.selector, id));
        rb.timeout(id);

        vm.warp(dl + late);
        uint256 before = other.balance;
        rb.timeout(id);
        assertEq(other.balance - before, uint256(price) + bond, "I4");
        assertEq(address(rb).balance, 0);
        assertConserved();
    }

    // ───────── 13. test vectors ─────────

    function test_Vector_KeccakConstantsMatch() public {
        assertEq(keccak256(bytes(S_INVOICE)), H_INVOICE);
        assertEq(keccak256(bytes(S_SUMMARISE)), H_SUMMARISE);
        console2.log("VECTOR invoice #4471 is ready for review => keccak:", vm.toString(H_INVOICE));
        console2.log("VECTOR summarise: q3 vendor contract => keccak:", vm.toString(H_SUMMARISE));
    }

    function _vectorRespond(string memory s, bytes32 expected) internal {
        uint256 id = _accepted();
        bytes memory out = bytes(s);
        vm.expectEmit(true, true, false, true, address(rb));
        emit ReplyBond.ResponseCommitted(id, expected, out, uint64(block.timestamp));
        _respond(id, out);
        assertEq(rb.getJob(id).responseHash, expected);
        vm.prank(buyer);
        rb.acknowledge(id);
        assertConserved();
    }

    function test_Vector_RespondInvoice_HashMatchesConstant() public {
        _vectorRespond(S_INVOICE, H_INVOICE);
    }

    function test_Vector_RespondSummarise_HashMatchesConstant() public {
        _vectorRespond(S_SUMMARISE, H_SUMMARISE);
    }
}

// ───────────────────────── invariant handler ─────────────────────────

contract ReplyBondHandler is Test {
    ReplyBond public rb;
    RejectingProvider public rejProv;
    address[] public actors;
    mapping(uint256 => ReplyBond.Status) public terminalSeen;
    mapping(uint256 => bool) public isTerminalSeen;
    bool public terminalChanged;
    uint256 public settled;

    constructor(ReplyBond _rb) {
        rb = _rb;
        rejProv = new RejectingProvider(_rb);
        vm.deal(address(rejProv), 1e30);
        for (uint256 i; i < 4; i++) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            vm.deal(a, 1e30);
        }
        vm.deal(address(this), 1e30);
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = rb.nextJobId();
        if (n == 1) return 0;
        return bound(seed, 1, n - 1);
    }

    /// I2 tracker: once terminal, a job's status must never change.
    function _track() internal {
        uint256 n = rb.nextJobId();
        for (uint256 id = 1; id < n; id++) {
            ReplyBond.Status s = rb.getJob(id).status;
            if (s >= ReplyBond.Status.Paid) {
                if (!isTerminalSeen[id]) {
                    isTerminalSeen[id] = true;
                    terminalSeen[id] = s;
                    settled++;
                } else if (terminalSeen[id] != s) {
                    terminalChanged = true;
                }
            } else if (isTerminalSeen[id]) {
                terminalChanged = true;
            }
        }
    }

    function post(uint256 aSeed, uint256 mode, uint256 price, uint256 bond, uint256 rw, uint256 gw) external {
        price = bound(price, 1, 1e18);
        bond = bound(bond, 1, 1e18);
        rw = bound(rw, 1, 200);
        gw = bound(gw, 0, 100);
        address a = _actor(aSeed);
        address designated = mode % 3 == 0 ? address(0) : _actor(mode);
        if (mode % 5 == 0) {
            rejProv.post{value: bond}(bytes32(aSeed), designated, price, uint64(rw), uint64(gw));
        } else {
            vm.prank(a);
            rb.postOffer{value: bond}(bytes32(aSeed), designated, price, uint64(rw), uint64(gw));
        }
        _track();
    }

    function accept(uint256 idSeed, uint256 aSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        ReplyBond.Job memory j = rb.getJob(id);
        address a = j.buyer != address(0) && aSeed % 4 != 0 ? j.buyer : _actor(aSeed);
        vm.prank(a);
        try rb.acceptOffer{value: j.price}(id) {} catch {}
        _track();
    }

    function respond(uint256 idSeed, uint256 len) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        address p = rb.getJob(id).provider;
        bytes memory out = new bytes(bound(len, 0, 1100));
        if (p == address(rejProv)) {
            try rejProv.respond(id, out) {} catch {}
        } else {
            vm.prank(p);
            try rb.respond(id, out) {} catch {}
        }
        _track();
    }

    function acknowledge(uint256 idSeed, uint256 aSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        address b = rb.getJob(id).buyer;
        vm.prank(aSeed % 6 == 0 ? _actor(aSeed) : b);
        try rb.acknowledge(id) {} catch {}
        _track();
    }

    function claim(uint256 idSeed, uint256 aSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        vm.prank(_actor(aSeed));
        try rb.claim(id) {} catch {}
        _track();
    }

    function timeout(uint256 idSeed, uint256 aSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        vm.prank(_actor(aSeed));
        try rb.timeout(id) {} catch {}
        _track();
    }

    function withdrawOffer(uint256 idSeed, uint256 aSeed) external {
        uint256 id = _id(idSeed);
        if (id == 0) return;
        address p = rb.getJob(id).provider;
        if (p == address(rejProv)) {
            try rejProv.withdrawOffer(id) {} catch {}
        } else {
            vm.prank(aSeed % 6 == 0 ? _actor(aSeed) : p);
            try rb.withdrawOffer(id) {} catch {}
        }
        _track();
    }

    function withdrawOwed(uint256 aSeed) external {
        if (aSeed % 3 == 0) {
            try rejProv.withdrawOwed() {} catch {}
        } else {
            vm.prank(_actor(aSeed));
            try rb.withdrawOwed() {} catch {}
        }
        _track();
    }

    function toggleRejecting(bool a) external {
        rejProv.setAccepting(a);
    }

    function warp(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 0, 150));
        _track();
    }
}

contract ReplyBondInvariantTest is Test {
    ReplyBond internal rb;
    ReplyBondHandler internal handler;

    function setUp() public {
        vm.warp(1000);
        rb = new ReplyBond();
        handler = new ReplyBondHandler(rb);
        targetContract(address(handler));
    }

    /// I1: balance == totalLocked + totalOwed, and locked recomputed from per-job state.
    function invariant_BalanceEqualsLockedPlusOwed() public view {
        assertEq(address(rb).balance, rb.totalLocked() + rb.totalOwed());
        uint256 locked;
        uint256 n = rb.nextJobId();
        for (uint256 id = 1; id < n; id++) {
            ReplyBond.Job memory j = rb.getJob(id);
            if (j.status == ReplyBond.Status.Open) locked += j.bond;
            else if (j.status == ReplyBond.Status.Accepted || j.status == ReplyBond.Status.Responded) {
                locked += j.price + j.bond;
            }
        }
        assertEq(locked, rb.totalLocked());
    }

    function invariant_OwedSumMatchesTotalOwed() public view {
        uint256 sum = rb.owed(address(handler.rejProv()));
        for (uint256 i; i < handler.actorsLength(); i++) {
            sum += rb.owed(handler.actors(i));
        }
        assertEq(sum, rb.totalOwed());
    }

    /// I2: no terminal job ever changes status.
    function invariant_TerminalJobsNeverChange() public view {
        assertFalse(handler.terminalChanged());
        uint256 n = rb.nextJobId();
        for (uint256 id = 1; id < n; id++) {
            if (handler.isTerminalSeen(id)) {
                assertTrue(rb.getJob(id).status == handler.terminalSeen(id));
            }
        }
    }
}
