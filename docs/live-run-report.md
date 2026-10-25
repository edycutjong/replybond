# ReplyBond live run on Arc Testnet

Contract 0x1234fb0fb613d284d98bbe2ff89045aae5d22458. Amounts are 18-decimal native USDC. Script: .scratch/run-flows.ts

## Run 1: timeout flow (job 1); its claim attempt used a 10s window and hit ResponseDeadlinePassed, so job 2 was left Accepted and settled via timeout in run 2
```
chainId 5042002 contract 0x1234fb0fb613d284d98bbe2ff89045aae5d22458
start balances (native view): provider 20 buyer 20 contract 0

######## FLOW 1: TIMEOUT ########
postOffer: 0x9c6ff037a49134c4b73dd3ef9af853ee6e5b4830669151f6c8c4f2c2f442d958 status=success block=68987107 maxFeePerGas=29000000000 effectiveGasPrice=25000000000
job id 1
acceptOffer: 0x004dd6429c087b8a214ccd495ed8bd2a4a564dcfa86bfba5fe036dd9c8b68164 status=success block=68987116 maxFeePerGas=29000000000 effectiveGasPrice=25000000000
deadline 1792909233 status Accepted
waiting past deadline (no respond)...
block ts past deadline: 1792909234
timeout: 0x712a4eee35154897220df6904be552094f195f71aeae0d82dfff318415ad31d2 status=success block=68987138 maxFeePerGas=29000000000 effectiveGasPrice=25000000000

=== TIMEOUT: FULL RECEIPT LOGS (2) ===
[
  {
    "address": "0x1234fb0fb613d284d98bbe2ff89045aae5d22458",
    "topics": [
      "0x506f72ca1dad25723e925f708d1c8a6e805357c74a704fc916b4e89d65d375f6",
      "0x0000000000000000000000000000000000000000000000000000000000000001",
      "0x000000000000000000000000e1bdab15addd605347ceaca5268ee157bd41e593",
      "0x00000000000000000000000010427423b93ea42c9bed43d8f1374033c06572a1"
    ],
    "data": "0x00000000000000000000000000000000000000000000000000354a6ba7a18000",
    "blockHash": "0x919f8de9e5643c289449843e955e092ba4771fd30d0f23f53c460982bd6afca6",
    "blockNumber": "68987138",
    "blockTimestamp": "1792909235",
    "transactionHash": "0x712a4eee35154897220df6904be552094f195f71aeae0d82dfff318415ad31d2",
    "transactionIndex": 6,
    "logIndex": 25,
    "removed": false
  },
  {
    "address": "0xfffffffffffffffffffffffffffffffffffffffe",
    "topics": [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x0000000000000000000000001234fb0fb613d284d98bbe2ff89045aae5d22458",
      "0x000000000000000000000000e1bdab15addd605347ceaca5268ee157bd41e593"
    ],
    "data": "0x00000000000000000000000000000000000000000000000000354a6ba7a18000",
    "blockHash": "0x919f8de9e5643c289449843e955e092ba4771fd30d0f23f53c460982bd6afca6",
    "blockNumber": "68987138",
    "blockTimestamp": "1792909235",
    "transactionHash": "0x712a4eee35154897220df6904be552094f195f71aeae0d82dfff318415ad31d2",
    "transactionIndex": 6,
    "logIndex": 26,
    "removed": false
  }
]
--- decoded ---
log#25 emitter=0x1234fb0fb613d284d98bbe2ff89045aae5d22458 [ReplyBond] {
  "eventName": "JobTimedOut",
  "args": {
    "id": "1",
    "buyer": "0xe1bdab15aDdd605347ceaca5268eE157bd41E593",
    "caller": "0x10427423b93Ea42C9BED43D8f1374033C06572A1",
    "amount": "15000000000000000"
  }
}
log#26 emitter=0xfffffffffffffffffffffffffffffffffffffffe [ARC SYSTEM EMITTER] ERC-20-style Transfer(from=0x1234fb0fb613d284d98bbe2ff89045aae5d22458, to=0xe1bdab15addd605347ceaca5268ee157bd41e593, value=15000000000000000)
>>> TIMEOUT: system-emitter Transfer(contract -> payee, 0.015 USDC at 18 decimals)? YES
    topics=[
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  "0x0000000000000000000000001234fb0fb613d284d98bbe2ff89045aae5d22458",
  "0x000000000000000000000000e1bdab15addd605347ceaca5268ee157bd41e593"
] data=0x00000000000000000000000000000000000000000000000000354a6ba7a18000 (=15000000000000000)
    logs from system emitter in this receipt: 1
buyer balance change: +0.015 USDC (expected +0.015)
contract balance change: -0.015 USDC
job status: TimedOut

```

## Run 2: cleanup of job 2, then claim flow (job 3)
```
chainId 5042002 contract 0x1234fb0fb613d284d98bbe2ff89045aae5d22458
start balances (native view): provider 19.979504675 buyer 19.991214125 contract 0.015
timeout: 0x2f147f943a287bacbdc4fe9fd3eed8ed5c2ceb9661207d7cfaf1aa44cc6adb46 status=success block=68987208 maxFeePerGas=29000000000 effectiveGasPrice=25000000000
cleanup job 2 status TimedOut

######## FLOW 2: CLAIM ########
postOffer: 0xdd64f5b27d1f73be2c9d8dee140b4a430cb76f74f3f1101519631466666be538 status=success block=68987216 maxFeePerGas=29000000000 effectiveGasPrice=25000000000
job id 3
acceptOffer: 0xf5aace600d2bdac46063f333f99d0ca6a4a262b253953b646ff56506464913f2 status=success block=68987225 maxFeePerGas=29000000000 effectiveGasPrice=25000000000
respond: 0x22e359758dc7174bbe2ead82b03ce83f2528867f0f59a9917bd28dc0af627085 status=success block=68987233 maxFeePerGas=29000000000 effectiveGasPrice=25000000000
responseHash 0x7d43cb7cf12f8ae72119ab31a72c43c76a0a0a20a7539b566ab40d38e4e36299 respondedAt 1792909283 grace 5
respond event: {
  "eventName": "ResponseCommitted",
  "args": {
    "id": "3",
    "responseHash": "0x7d43cb7cf12f8ae72119ab31a72c43c76a0a0a20a7539b566ab40d38e4e36299",
    "output": "0x696e766f69636520233434373120697320726561647920666f7220726576696577",
    "respondedAt": "1792909283"
  }
}
waiting past respondedAt + grace...
block ts past grace: 1792909289
claim: 0x8f221c12aaefc270c0bc6ac33533533d7cb245958fec66eaabeada1f58b76584 status=success block=68987248 maxFeePerGas=29000000000 effectiveGasPrice=25000000000

=== CLAIM: FULL RECEIPT LOGS (2) ===
[
  {
    "address": "0x1234fb0fb613d284d98bbe2ff89045aae5d22458",
    "topics": [
      "0xc2618f953d4fdd3af6e22adc3c2c9cde2277fac47c72e99d6233edf27ce62f53",
      "0x0000000000000000000000000000000000000000000000000000000000000003",
      "0x00000000000000000000000010427423b93ea42c9bed43d8f1374033c06572a1",
      "0x000000000000000000000000e1bdab15addd605347ceaca5268ee157bd41e593"
    ],
    "data": "0x00000000000000000000000000000000000000000000000000354a6ba7a18000",
    "blockHash": "0xa99c9391bfce472d0720b21b3da6def1e3c9f40c9677da6f0bea13a5d783ba45",
    "blockNumber": "68987248",
    "blockTimestamp": "1792909290",
    "transactionHash": "0x8f221c12aaefc270c0bc6ac33533533d7cb245958fec66eaabeada1f58b76584",
    "transactionIndex": 2,
    "logIndex": 5,
    "removed": false
  },
  {
    "address": "0xfffffffffffffffffffffffffffffffffffffffe",
    "topics": [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x0000000000000000000000001234fb0fb613d284d98bbe2ff89045aae5d22458",
      "0x00000000000000000000000010427423b93ea42c9bed43d8f1374033c06572a1"
    ],
    "data": "0x00000000000000000000000000000000000000000000000000354a6ba7a18000",
    "blockHash": "0xa99c9391bfce472d0720b21b3da6def1e3c9f40c9677da6f0bea13a5d783ba45",
    "blockNumber": "68987248",
    "blockTimestamp": "1792909290",
    "transactionHash": "0x8f221c12aaefc270c0bc6ac33533533d7cb245958fec66eaabeada1f58b76584",
    "transactionIndex": 2,
    "logIndex": 6,
    "removed": false
  }
]
--- decoded ---
log#5 emitter=0x1234fb0fb613d284d98bbe2ff89045aae5d22458 [ReplyBond] {
  "eventName": "JobClaimed",
  "args": {
    "id": "3",
    "provider": "0x10427423b93Ea42C9BED43D8f1374033C06572A1",
    "caller": "0xe1bdab15aDdd605347ceaca5268eE157bd41E593",
    "amount": "15000000000000000"
  }
}
log#6 emitter=0xfffffffffffffffffffffffffffffffffffffffe [ARC SYSTEM EMITTER] ERC-20-style Transfer(from=0x1234fb0fb613d284d98bbe2ff89045aae5d22458, to=0x10427423b93ea42c9bed43d8f1374033c06572a1, value=15000000000000000)
>>> CLAIM: system-emitter Transfer(contract -> payee, 0.015 USDC at 18 decimals)? YES
    topics=[
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  "0x0000000000000000000000001234fb0fb613d284d98bbe2ff89045aae5d22458",
  "0x00000000000000000000000010427423b93ea42c9bed43d8f1374033c06572a1"
] data=0x00000000000000000000000000000000000000000000000000354a6ba7a18000 (=15000000000000000)
    logs from system emitter in this receipt: 1
provider balance change: +0.015 USDC (expected +0.015)
contract balance change: -0.015 USDC
job status: Claimed
contract totalLocked/totalOwed: [
  "0",
  "0"
]
end balances: provider 19.9822732 buyer 19.992819525 contract 0
```
