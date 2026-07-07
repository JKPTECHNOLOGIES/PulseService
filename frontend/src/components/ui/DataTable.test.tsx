import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DataTable, { type Column } from "./DataTable";

interface Row {
  id: string;
  name: string;
  qty: number;
}

const rows: Row[] = [
  { id: "1", name: "Banana", qty: 2 },
  { id: "2", name: "apple", qty: 5 },
  { id: "3", name: "Cherry", qty: 1 },
];

const columns: Column<Row>[] = [
  {
    key: "name",
    header: "Name",
    sortValue: (r) => r.name.toLowerCase(),
    render: (r) => <span>{r.name}</span>,
  },
  {
    key: "qty",
    header: "Qty",
    sortValue: (r) => r.qty,
    render: (r) => <span>{r.qty}</span>,
  },
];

function nameColumnOrder(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll("tbody tr")).map(
    (tr) => tr.querySelector("td")?.textContent ?? null,
  );
}

describe("DataTable", () => {
  it("renders a row per item", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={null}
        onSortChange={() => undefined}
      />,
    );
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("apple")).toBeInTheDocument();
    expect(screen.getByText("Cherry")).toBeInTheDocument();
  });

  it("orders rows by the active sort (case-insensitive, ascending)", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={{ key: "name", dir: "asc" }}
        onSortChange={() => undefined}
      />,
    );
    expect(nameColumnOrder(container)).toEqual(["apple", "Banana", "Cherry"]);
  });

  it("requests an ascending sort when a sortable header is clicked", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={null}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByText("Name"));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", dir: "asc" });
  });

  it("toggles to descending when the active column is clicked again", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={{ key: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByText("Name"));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", dir: "desc" });
  });

  it("reports the newly-selected id when a row checkbox is clicked", () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        sort={null}
        onSortChange={() => undefined}
        selectable
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // checkboxes[0] is the header "select all" checkbox.
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith(["1"]);
  });

  it("keeps a row checked (controlled by the parent's state) after clicking it, instead of reverting", () => {
    function StatefulWrapper() {
      const [selectedIds, setSelectedIds] = useState<string[]>([]);
      return (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          sort={null}
          onSortChange={() => undefined}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      );
    }
    render(<StatefulWrapper />);
    const checkboxes = screen.getAllByRole<HTMLInputElement>("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(checkboxes[1].checked).toBe(true);
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("selects every row when the header checkbox is clicked, and stays checked", () => {
    function StatefulWrapper() {
      const [selectedIds, setSelectedIds] = useState<string[]>([]);
      return (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          sort={null}
          onSortChange={() => undefined}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      );
    }
    render(<StatefulWrapper />);
    const headerCheckbox = screen.getAllByRole<HTMLInputElement>("checkbox")[0];
    fireEvent.click(headerCheckbox);
    const checkboxes = screen.getAllByRole<HTMLInputElement>("checkbox");
    expect(checkboxes.every((c) => c.checked)).toBe(true);
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });
});
