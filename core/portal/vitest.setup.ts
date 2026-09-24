// jsdom does not implement ResizeObserver or matchMedia, both of which
// several Radix/vendor primitives touch on mount (Tooltip/Command via
// @radix-ui/react-use-size's ResizeObserver, sonner's Toaster via
// matchMedia for its dark/light auto-detect). These are the same "stub the
// two things a headless DOM never had" tests everyone hits validating
// Radix-based component trees under jsdom — not app behaviour, so a
// minimal stub here (rather than in `next-themes` app wiring) is correct.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- jsdom has no ResizeObserver typing to satisfy here.
  globalThis.ResizeObserver = ResizeObserverStub;
}

// jsdom also has no layout engine, so scrollIntoView (used by cmdk to keep
// the highlighted command item in view) is simply absent.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
