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
});
