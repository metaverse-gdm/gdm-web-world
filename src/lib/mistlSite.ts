// Works hosted with `mistl upload` are served by the viewer's own mistl at
// http://<siteId>.localhost:<port>/ (loopback only), so they open only where
// mistl is installed. The catalog stores that URL in the ordinary `url` field.
const SITE_URL = /^http:\/\/([a-z2-7]{32})\.localhost(?::(\d{1,5}))?(?:[/?#]|$)/

export const MISTL_RELEASES_URL = 'https://github.com/tik-choco/mistl/releases/latest'

/** The site id when `url` points at a mistl-hosted site, otherwise undefined. */
export function mistlSiteId(url: string | undefined): string | undefined {
  if (!url) return undefined
  const match = SITE_URL.exec(url)
  if (!match) return undefined
  const port = match[2] === undefined ? 80 : Number(match[2])
  return port >= 1 && port <= 65535 ? match[1] : undefined
}

export const isMistlSite = (url: string | undefined) => mistlSiteId(url) !== undefined
