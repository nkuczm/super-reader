/**
 * Work that has to finish in time, or give way to what is already in hand.
 *
 * A function on this deployment is stopped at sixty seconds, and a stopped
 * function answers nothing — not the sources that were read in two seconds,
 * not anything. So the slow part of a refresh races a clock, and losing the
 * race costs only that part: a source that is still reading its feed is
 * reported as slow, and one that is still reading article pages for their
 * pictures is returned without them.
 */
export function within<T>(work: Promise<T>, ms: number, instead: () => T): Promise<T> {
  if (ms <= 0) {
    // Nobody will wait for it; don't leave it to reject unheard.
    work.catch(() => {});
    return Promise.resolve(instead());
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(instead()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** A clock started now: how long is left of `budgetMs`. */
export function budget(budgetMs: number, now: () => number = Date.now) {
  const end = now() + budgetMs;
  return () => end - now();
}
