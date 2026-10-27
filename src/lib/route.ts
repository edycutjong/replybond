import { useSyncExternalStore } from 'react'

export type Route = 'landing' | 'app'

/** `/` is the landing page; `/app` and anything below it is the app. Any other path shows the landing page. */
export function routeFor(pathname: string): Route {
  return /^\/app(\/|$)/.test(pathname) ? 'app' : 'landing'
}

const CHANGE = 'replybond:route'

/** Client-side navigation without a router dependency: push the path and tell subscribers. */
export function navigate(to: '/' | '/app'): void {
  if (window.location.pathname !== to) window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(CHANGE))
  window.scrollTo(0, 0)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(CHANGE, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(CHANGE, onChange)
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => routeFor(window.location.pathname), () => 'landing')
}
