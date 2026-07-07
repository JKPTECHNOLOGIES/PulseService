import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import SearchInput from "../components/ui/SearchInput";
import DataTable, { type Column } from "../components/ui/DataTable";

// Reproduces the CustomersPage wiring that caused row selections to vanish:
// a SearchInput and a selectable DataTable share a `resetPage` handler that
// clears the selection. Before the SearchInput fix, any re-render (like ticking
// a checkbox) re-fired the debounced onChange -> resetPage -> selection wiped.

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [
  { id: "1", name: "Michael Brown" },
  { id: "2", name: "Susan Thompson" },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Name", render: (r) => <span>{r.name}</span> },
];

function CustomersLike() {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const resetPage = () => {
    setSelectedIds([]);
  };

  return (
    <div>
      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          resetPage();
        }}
      />
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const firstRowCheckbox = () => screen.getAllByRole("checkbox")[1];

describe("Customers page selection", () => {
  it("keeps a row selected after the search debounce window elapses", () => {
    render(<CustomersLike />);

    fireEvent.click(firstRowCheckbox());
    expect(firstRowCheckbox()).toBeChecked();

    // Let any (buggy) debounced search emission fire. Selection must survive.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(firstRowCheckbox()).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});
