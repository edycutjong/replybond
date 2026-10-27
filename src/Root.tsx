import { useEffect } from 'react'
import App from './App'
import Landing from './Landing'
import { useRoute } from './lib/route'

const TITLES = {
  landing: 'ReplyBond: get paid back when an API misses its deadline',
  app: 'ReplyBond app: call the API, watch a missed deadline settle',
} as const

/** `/` is the landing page, `/app` the app. Each route sets its own document title. */
export default function Root() {
  const route = useRoute()
  useEffect(() => {
    document.title = TITLES[route]
  }, [route])
  return route === 'app' ? <App /> : <Landing />
}
