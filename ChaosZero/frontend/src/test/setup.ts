import "@testing-library/jest-dom/vitest";
import fc from "fast-check";
import { fuzzParameters } from "./fuzz";

fc.configureGlobal(fuzzParameters);

// jsdom lacks these browser APIs used by animation / observer code paths.
if (typeof window !== "undefined") {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  window.IntersectionObserver ??= class {
    root = null;
    rootMargin = "";
    thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;

  Element.prototype.scrollIntoView ??= () => {};
}
