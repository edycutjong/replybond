import { isAddress } from 'viem'
import { ctx, sameAddr } from './_lib/config.js'
import { ownWalletOffer } from './_lib/flows.js'
import { HttpError, bodyOf, route } from './_lib/http.js'

/** POST /api/offer {buyer}: the provider posts a normal offer designated to the connected wallet. */
export default route(['POST'], async (req) => {
  const { buyer } = bodyOf(req)
  if (typeof buyer !== 'string' || !isAddress(buyer)) throw new HttpError(400, 'buyer must be an address')
  if (/^0x0{40}$/i.test(buyer)) throw new HttpError(400, 'buyer must not be the zero address (no open offers)')
  if (sameAddr(buyer, ctx().providerAddress)) throw new HttpError(400, 'buyer must not be the provider wallet')
  const r = await ownWalletOffer(buyer)
  return { status: r.status, body: r.body }
})
