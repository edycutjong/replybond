# API routes exercised in the preview (Arc Testnet)

Contract 0x1234fb0fb613d284d98bbe2ff89045aae5d22458, wallets from /tmp/rb-keys.json via PROVIDER_KEY / DEMO_BUYER_KEY (never printed). All requests went to `localhost:5173` through the preview's `/api` handler. Hashes are full; large receipts trimmed to the settle logs.

## 1. GET /api/sweep (HTTP 200, 1.0 s)
`{"chainTime":1792909914,"scannedJobs":3,"fromBlock":"68986043","responded":[],"claimed":[],"withdrawn":[],"skipped":[],"errors":[]}`

## 2. POST /api/demo-run {"mode":"normal"} (HTTP 200, 5.0 s)
Job 4. output `INVOICE #4471 IS READY FOR REVIEW`, responseHash `0x53940dac8febdb0951e751068a000b8b8242f1dda807720750488b018d6457b4`, finalStatus `Paid`.
- postOffer `0x8a908465978eb790ed791df6098fd9f58e156ffb3bcaf2550f71eba9ca7dceb7`
- acceptOffer `0xe3ae201760158385d763dfe9d1362255eb3da4f18a4409902f3a15e696cb0ef6`
- respond `0x97e0c42d117b8e327cc70079e2396b854c1157aff337044af881f4dd30e7991c`
- acknowledge `0x94e395455dd8bd4d8d15e540fd23a04b62be789fbb78f9715a85fc3bac388f29`

## 3. POST /api/demo-run {"mode":"silent"} (HTTP 200)
Job 5, deadline 1792909977. postOffer `0x4a4d8db9549b0dc2826a32deb60b52c75b153eb58f37b6443e39685683be34e5`, acceptOffer `0x8487cf8a39172160671ba1e1858aa6fb0a0ade83e9802200f320e88f9fd1e049`.

## 3b. Immediately after: POST /api/demo-run {"mode":"normal"} (HTTP 409 busy)
`{"error":"busy","retryAt":1792909978,"retryInSeconds":46,"busy":{"reasons":[{"kind":"accepted_within_deadline","detail":"job 5 is Accepted, deadline 1792909977"}]},"rate":{"hour":{"count":5,"max":30},"day":{"count":5,"max":150}},"pool":{"target":3,"size":1,"ready":[],"waiting":["5"],"nextReadyInSeconds":46}}`

## 4. POST /api/job
- `{"jobId":5}` (silent, ours): 200 `{"accepted":true,"jobId":"5","deadline":1792909977,"pastDeadline":false,"settle":{"action":"wait","readyInSeconds":46}}`
- `{"jobId":5,"mode":"normal"}`: 403 `{"refused":true,"reason":"refused: fixture record is mode \"silent\", requested \"normal\""}`
- `{"jobId":999}`: 404 `{"refused":true,"reason":"job does not exist"}`
- `{"jobId":6}` (posted by the buyer wallet acting as another provider): 403 `{"refused":true,"reason":"not our job: provider is not PROVIDER_ADDRESS"}`
- `{"jobId":7}` (our provider, requestHash not in src/offers.json): 403 `{"refused":true,"reason":"refused: requestHash does not match any fixture record"}`
Jobs 6 and 7 were withdrawn afterwards (`0x97a1d1d1fda27d9eb03046eb8aaa7b6a1585d66752decb71db2e0f757d569839`, `0x7049e397782cd112185632b78af839d2c77ff02f7485d32cc423d9c3d52e9d43`).

## 5. POST /api/settle {} before any pooled job was past its deadline (HTTP 200)
`{"settled":false,"note":"Next one ready in 16 s.","nextReadyInSeconds":16,"latestSettledTimeout":{"jobId":"2","receipt":{"txHash":"0x2f147f943a287bacbdc4fe9fd3eed8ed5c2ceb9661207d7cfaf1aa44cc6adb46","status":"success","blockNumber":"68987208", ...system-emitter Transfer log included...}},"pool":{"size":1,"waiting":["5"]}}`

## 6. GET /api/demo-refill (HTTP 200)
Pool had 1 (job 5), target 3, created jobs 8 and 9.
- job 8: postOffer `0x129934b2afcaba592e5e04a96f9c82d8bb03e5ae37938e6383caa620b585dcb7`, acceptOffer `0xf50fe9933c42e12b5261f89fc848841ec54ddf96c89e6c941e734a12903e22bc`
- job 9: postOffer `0x5ef89029605afd2d0fa54cdb6011816448456e4c0c35963b7a305646bf8b1c39`, acceptOffer `0xc1e1f3984f46062240d59baea66b150d55525650729467e0085bbe2c980ac31c`
- after: `pool: {size:3, ready:["5"], waiting:["8","9"], nextReadyInSeconds:0}`

## 7. POST /api/settle {} with job 5 past its deadline (HTTP 200)
Timed out job 5 from the pool: tx `0xedd0c63cc75a557cae36fa320db0063acacdd96ce8815fa61b2832c2a7b01a6f`, block 68988623, gasUsed 54377. Receipt logs:
- #3 ReplyBond `JobTimedOut`: topics `0x506f72ca…75f6`, `…0005`, `…e1bdab15…e593`, `…e1bdab15…e593`, data `0x…354a6ba7a18000`
- #4 `0xfffffffffffffffffffffffffffffffffffffffe` Transfer: topics `0xddf252ad…b3ef`, `0x…1234fb0fb613d284d98bbe2ff89045aae5d22458`, `0x…e1bdab15addd605347ceaca5268ee157bd41e593`, data `0x…354a6ba7a18000` (0.015 USDC)
Pool afterwards: size 2 (jobs 8, 9 waiting).

## 8. POST /api/offer {"buyer":"0xe1bdab15aDdd605347ceaca5268eE157bd41E593"} (HTTP 200)
Job 10, txHash `0x55c796dc42f87ab908c250fb03c5914be463d950eb13b70f968e090bc9f6046b`, price 0.01, bond 0.005, responseWindow 45, graceWindow 120. The buyer wallet then accepted it itself (`0xf60708a84754446a4e494c9ce683b82174c020e24ac4e19e1f3c306fdca43126`), without calling /api/job.
- GET /api/sweep right after: `responded:[{"jobId":"10","txHash":"0x807d6328f12bd0a11495b20266a2780533fcaab46bfff72c75d98263eea5de59"}]`
- Two parallel GET /api/sweep after the 120 s grace window: one `claimed:[{"jobId":"10","txHash":"0xfa4331c29d721694bfc54501373bafe991ee2f0b4f1fd169097fcf1484144acf"}]`, the other `skipped:[{"jobId":"10","action":"claim","why":"job is no longer Responded"}]`.

## 9. Idempotent settle with jobId
- `{"jobId":8}` first call: timeout, tx `0xa284069d38fad8a9961d485a71ae3e7301311aeda32281456e1851888a83a54e`, 2 receipt logs.
- `{"jobId":8}` second call: `alreadySettled:true, state:"TimedOut"`, same txHash and logs.
- `{"jobId":9}`: timeout tx `0x63bb2e686ce982404479dd15e7ab05857338725e6bae1a5419dd44d444e925ac`; pool now empty.
- `{"jobId":6}`: 403 not our job.
