import { BOND, PRICE, RESPONSE_WINDOW_S } from './terms'

export interface TermsSource {
  price?: bigint | null
  bond?: bigint | null
  /** Seconds. */
  responseWindow?: number | null
}

/**
 * The terms a job card is drawn with: what the job says on chain wins; before the event scan has caught up, what the
 * server reported for the job it just posted; only then the defaults. A job picked at 90 s and 0.020 therefore counts
 * down 90 s and pays out 0.010 + 0.020.
 */
export function cardTerms(job: TermsSource | undefined, fallback: TermsSource | undefined): { price: bigint; bond: bigint; responseWindow: number } {
  return {
    price: job?.price ?? fallback?.price ?? PRICE,
    bond: job?.bond ?? fallback?.bond ?? BOND,
    responseWindow: job?.responseWindow ?? fallback?.responseWindow ?? RESPONSE_WINDOW_S,
  }
}
