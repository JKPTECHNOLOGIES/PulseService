import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SearchInput from "./SearchInput";

describe("SearchInput", () => {
  it("does not re-fire a stale onChange when the parent re-renders for an unrelated reason", () => {
    vi.useFakeTimers();

    // Mirrors real pages: `onChange` is an inline arrow function that also
    // resets other state (e.g. CustomersPage's resetPage(), which clears row
    // selection), and gets a brand-new identity on every render.
    function Harness() {
      const [search, setSearch] = useState("");
      const [selected, setSelected] = useState(false);

      return (
        <div>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setSelected(false);
            }}
          />
          <button
            onClick={() => {
              setSelected(true);
            }}
          >
            select
          </button>
          <span>{selected ? "selected" : "not selected"}</span>
        </div>
      );
    }

    render(<Harness />);

    // Let the initial mount's debounce cycle settle first (SearchInput always
    // fires one onChange call ~300ms after mount, even with an unchanged
    // value -- that's expected and unrelated to the bug under test here).
    act(() => {
      vi.advanceTimersByTime(400);
    });

    // Now simulate an unrelated state update in the parent (e.g. clicking a
    // row checkbox), which re-renders the tree and gives SearchInput's
    // inline `onChange` prop a new function identity, even though nothing
    // was typed.
    fireEvent.click(screen.getByText("select"));
    expect(screen.getByText("selected")).toBeInTheDocument();

    // Advance past another debounce window. Before the fix, the re-render
    // above would re-arm the debounce timer (since localValue never changed,
    // it wouldn't have fired otherwise) and call the stale onChange(""),
    // wiping out the unrelated selection state a moment later.
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText("selected")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("still debounces and reports what the user actually typed", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();

    render(<SearchInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "acme" },
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("acme");

    vi.useRealTimers();
  });
});
