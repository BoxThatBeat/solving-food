/** `households/<hid>/…` as a listener key (live.ts keys and listener labels). */
export const hh = (hid: string, ...rest: string[]) => ["households", hid, ...rest].join("/");
