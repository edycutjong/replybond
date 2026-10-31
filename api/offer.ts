import { isAddress } from 'viem'
import { ctx, sameAddr } from './_lib/config.js'
import { ownWalletOffer } from './_lib/flows.js'
import { HttpError, bodyOf, route } from './_lib/http.js'
import { parseTermsChoice } from '../src/lib/terms.js'

/** POST /api/offer {buyer, windowS?, bond?}: the provider posts a normal offer designated to the connected wallet, with the chosen deadline and bond. */
export default route(['POST'], async (req) => {
  const body = bodyOf(req)
  const { buyer } = body
  if (typeof buyer !== 'string' || !isAddress(buyer)) throw new HttpError(400, 'buyer must be an address')
  if (/^0x0{40}$/i.test(buyer)) throw new HttpError(400, 'buyer must not be the zero address (no open offers)')
  if (sameAddr(buyer, ctx().providerAddress)) throw new HttpError(400, 'buyer must not be the provider wallet')
  const parsed = parseTermsChoice(body)
  if (!parsed.ok) throw new HttpError(400, parsed.error)
  const r = await ownWalletOffer(buyer, undefined, parsed.chosen ? parsed.terms : undefined)
  return { status: r.status, body: r.body }
})
