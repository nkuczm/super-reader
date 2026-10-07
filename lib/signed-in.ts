/**
 * Whether this page has a Google account signed in — for the few helpers
 * outside the reader (AI spending, the extension's saved pages) that send to
 * the account rather than to an old sync code.
 */
let signedIn = false;
export const setSignedIn = (value: boolean) => {
  signedIn = value;
};
export const isSignedIn = () => signedIn;
