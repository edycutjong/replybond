import { parseAbi } from 'viem'

/** Minimal ReplyBond ABI (committed so Vercel does not depend on contracts/out). */
export const replyBondAbi = parseAbi([
  'function getJob(uint256 id) view returns ((address provider, address buyer, uint256 price, uint256 bond, bytes32 requestHash, uint64 responseWindow, uint64 graceWindow, uint64 deadline, uint64 respondedAt, bytes32 responseHash, uint8 status))',
  'function postOffer(bytes32 requestHash, address buyer, uint256 price, uint64 responseWindow, uint64 graceWindow) payable returns (uint256 id)',
  'function withdrawOffer(uint256 id)',
  'function acceptOffer(uint256 id) payable',
  'function respond(uint256 id, bytes output)',
  'function acknowledge(uint256 id)',
  'function claim(uint256 id)',
  'function timeout(uint256 id)',
  'event OfferPosted(uint256 indexed id, address indexed provider, address indexed buyer, bytes32 requestHash, uint256 price, uint256 bond, uint64 responseWindow, uint64 graceWindow)',
  'event OfferWithdrawn(uint256 indexed id, address indexed provider, uint256 bond)',
  'event OfferAccepted(uint256 indexed id, address indexed buyer, uint64 deadline)',
  'event ResponseCommitted(uint256 indexed id, bytes32 indexed responseHash, bytes output, uint64 respondedAt)',
  'event JobPaid(uint256 indexed id, address indexed provider, uint256 amount)',
  'event JobClaimed(uint256 indexed id, address indexed provider, address indexed caller, uint256 amount)',
  'event JobTimedOut(uint256 indexed id, address indexed buyer, address indexed caller, uint256 amount)',
  'event PayoutOwed(uint256 indexed id, address indexed payee, uint256 amount)',
  'error UnknownJob(uint256 id)',
  'error WrongStatus(uint256 id, uint8 expected, uint8 actual)',
  'error NotProvider(uint256 id)',
  'error NotBuyer(uint256 id)',
  'error InvalidBond()',
  'error InvalidPrice()',
  'error InvalidResponseWindow()',
  'error IncorrectPayment(uint256 expected, uint256 actual)',
  'error DeadlineOverflow()',
  'error ResponseDeadlinePassed(uint256 id)',
  'error DeadlineNotPassed(uint256 id)',
  'error GraceWindowNotPassed(uint256 id)',
  'error InvalidOutputLength(uint256 length)',
])

export const Status = {
  Open: 0,
  Accepted: 1,
  Responded: 2,
  Paid: 3,
  Claimed: 4,
  TimedOut: 5,
  Withdrawn: 6,
} as const

export const STATUS_NAMES = ['Open', 'Accepted', 'Responded', 'Paid', 'Claimed', 'TimedOut', 'Withdrawn'] as const
