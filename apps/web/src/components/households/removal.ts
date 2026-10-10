// Tells the shell's removal notice apart from leaving on purpose: a household I left myself needs no "you were removed"
// banner.
let selfLeft: string | null = null;

export function markSelfLeft(hid: string): void {
  selfLeft = hid;
}

export function consumeSelfLeft(hid: string): boolean {
  if (selfLeft !== hid) return false;
  selfLeft = null;
  return true;
}
