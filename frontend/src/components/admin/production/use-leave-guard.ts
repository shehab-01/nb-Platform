"use client";

import * as React from "react";

/**
 * While `active`, leaving the page asks first: closing or reloading the tab
 * gets the browser's own prompt, and following a link inside the admin (the
 * sidebar, a close button, …) asks `message` and stays if the answer is no.
 *
 * The App Router has no way to block a navigation, so links are caught on
 * their way down: a capturing listener on the document runs before React's
 * own (attached at the root), and stopping the click there keeps Next's
 * <Link> from navigating at all.
 */
export function useLeaveGuard(active: boolean, message: string) {
  React.useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      // A new tab or window leaves this one as it is.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;
      const to = new URL(link.href, window.location.href);
      const here = window.location;
      if (to.origin === here.origin && to.pathname === here.pathname && to.search === here.search) {
        return;
      }
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}
