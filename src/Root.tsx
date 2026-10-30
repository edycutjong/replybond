import { Suspense, lazy, useEffect } from 'react'
import Landing from './Landing'
import { loadAppRoute } from './lib/appLoader'
import { useRoute } from './lib/route'

const AppRoute = lazy(loadAppRoute)

const TITLES = {
  landing: 'ReplyBond: get paid back when an API misses its deadline',
  app: 'ReplyBond app: call the API, watch a missed deadline settle',
} as const

/** `/` is the landing page, `/app` the app (loaded on demand). Each route sets its own document title. */
export default function Root() {
  const route = useRoute()
  useEffect(() => {
    document.title = TITLES[route]
  }, [route])
  if (route === 'landing') return <Landing />
  return (
    <Suspense fallback={<p role="status" className="label" style={{ padding: 24 }}>Loading the app …</p>}>
      <AppRoute />
    </Suspense>
  )
}
