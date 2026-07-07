import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import SearchInput from "./SearchInput";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchInput", () => {
  it("does not emit onChange on mount or on unrelated parent re-renders", () => {
    const onChange = vi.fn();

    // Simulates a parent that re-renders (e.g. selecting a table row) and
    // passes a fresh inline onChange identity each render.
    function Parent() {
      const [, setTick] = useState(0);
      return (
        <div>
          <button
            onClick={() => {
              setTick((t) => t + 1);
            }}
          >
            rerender
          </button>
          <SearchInput
            value="foo"
            onChange={(v) => {
              onChange(v);
            }}
          />
        </div>
      );
    }

    render(<Parent />);

    // Re-render the parent a few times without touching the input.
    fireEvent.click(screen.getByText("rerender"));
    fireEvent.click(screen.getByText("rerender"));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The value never changed, so onChange must not fire and clobber parent state.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("emits the debounced value when the user types", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "acme" },
    });

    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("acme");
  });
});
