import "@testing-library/jest-dom";

// jsdom doesn't implement matchMedia; stub it (defaults to "not mobile") so the
// useIsMobile hook works under test.
window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});
