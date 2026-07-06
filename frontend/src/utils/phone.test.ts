import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastSuccess = vi.fn();
const toastBase = vi.fn();
vi.mock("react-hot-toast", () => {
  const t = (msg: string, opts?: unknown): void => {
    toastBase(msg, opts);
  };
  t.success = (msg: string): void => {
    toastSuccess(msg);
  };
  return { default: t };
});

import { dialOrCopyPhone } from "./phone";

const setUserAgent = (ua: string) => {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
};

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148";

beforeEach(() => {
  toastSuccess.mockClear();
  toastBase.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dialOrCopyPhone", () => {
  it("copies a formatted number and toasts on desktop (no dialer)", async () => {
    setUserAgent(DESKTOP_UA);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await dialOrCopyPhone("7705551001");

    expect(writeText).toHaveBeenCalledWith("(770) 555-1001");
    expect(toastSuccess).toHaveBeenCalledWith(
      "Phone number copied: (770) 555-1001",
    );
  });

  it("opens the dialer (does not copy) on a mobile device", async () => {
    setUserAgent(MOBILE_UA);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const assign = vi.fn();
    // Replace location so we can observe the tel: navigation without jsdom noise.
    Object.defineProperty(window, "location", {
      value: {
        set href(v: string) {
          assign(v);
        },
      },
      configurable: true,
    });

    await dialOrCopyPhone("(770) 555-1001");

    expect(assign).toHaveBeenCalledWith("tel:7705551001");
    expect(writeText).not.toHaveBeenCalled();
  });
});
