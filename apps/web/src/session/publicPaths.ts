/** Recipe and saved-meal pages also render for signed-out visitors (share links, R4.21); everything else needs a ready session. */
export function isPublicPath(pathname: string): boolean {
  return /^\/recipes\/(?!new$|trash$)[^/]+\/?$/.test(pathname) || /^\/meals\/[^/]+\/?$/.test(pathname);
}
