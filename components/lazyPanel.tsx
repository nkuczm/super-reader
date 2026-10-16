"use client";

import { createElement, useEffect, useState, type Attributes, type ComponentType } from "react";

/**
 * A component kept in a file of its own, fetched the first time it is shown
 * or when `preload()` asks — and, once fetched, drawn straight away.
 *
 * Not next/dynamic: that suspends on a panel's first showing even when its
 * file is already here, and React holds a suspended panel back for up to
 * 300ms before revealing it, so a panel fetched in advance to open
 * instantly still opened late (measured: Subjects, 605ms against 368ms
 * with the panel in the page's own script).
 */
export function lazyPanel<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<unknown> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (module) => (loaded = module.default),
      (error) => {
        // Offline, or a deploy replaced the file: the next showing asks again.
        pending = null;
        throw error;
      },
    ));
  function Panel(props: P) {
    const [, setReady] = useState(false);
    useEffect(() => {
      if (!loaded) preload().then(() => setReady(true), () => {});
    }, []);
    return loaded ? createElement(loaded, props as P & Attributes) : null;
  }
  return Object.assign(Panel, { preload });
}
