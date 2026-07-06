import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataTable, { type Column } from "./DataTable";

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: "1", name: "Banana" },
  { id: "2", name: "Apple" },
];

const columns: Column<Row>[] = [
  {
    key: "name",
    header: "Name",
    render: (r) => <span>{r.name}</span>,
  },
];

function Harness({
  onRowClick,
  onChangeSpy,
}: {
  onRowClick?: (r: Row) => void;
  onChangeSpy?: (ids: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      selectable
      selectedIds={selectedIds}
      onSelectionChange={(ids) => {
        onChangeSpy?.(ids);
        setSelectedIds(ids);
      }}
      onRowClick={onRowClick}
    />
  );
}

// Checkboxes render in DOM order: [0] = header "select all", [1..] = one per row.
const firstRowCheckbox = () => screen.getAllByRole("checkbox")[1];

describe("DataTable selection", () => {
  it("keeps a row selected after clicking its checkbox", () => {
    render(<Harness />);
    const first = firstRowCheckbox();

    expect(first).not.toBeChecked();
    fireEvent.click(first);
    expect(first).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("does not trigger row navigation when the checkbox is clicked", () => {
    const onRowClick = vi.fn();
    render(<Harness onRowClick={onRowClick} />);
    fireEvent.click(firstRowCheckbox());
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("selects (not deselects) on a realistic user click", async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);

    await user.click(firstRowCheckbox());

    // A single real click must fire onSelectionChange exactly once and leave
    // the row selected. If it fired twice (e.g. change + a row-level toggle),
    // the item would immediately deselect.
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenLastCalledWith(["1"]);
    expect(firstRowCheckbox()).toBeChecked();
  });
});
