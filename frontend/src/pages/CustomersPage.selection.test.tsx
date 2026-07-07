import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mock the data/metadata hooks so we can render the real CustomersPage ---
vi.mock("../hooks/useCustomers", () => ({
  useCustomers: () => ({
    data: {
      data: [
        {
          id: "c1",
          customerNumber: "CUST-1005",
          firstName: "Michael",
          lastName: "Brown",
          companyName: "Brown Properties LLC",
          type: "commercial",
          phone: "6785555001",
          email: "mbrown@brownproperties.com",
          balance: 0,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
        {
          id: "c2",
          customerNumber: "CUST-1004",
          firstName: "Susan",
          lastName: "Thompson",
          companyName: null,
          type: "residential",
          phone: "7705554001",
          email: "sthompson@email.com",
          balance: 0,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    },
    isLoading: false,
  }),
}));

vi.mock("../hooks/useMetadata", () => ({
  useLookup: () => ({
    options: [
      { value: "residential", label: "Residential" },
      { value: "commercial", label: "Commercial" },
    ],
    getLabel: (v: string) => v,
    getColor: () => "",
  }),
}));

vi.mock("../hooks/useSavedViews", () => ({
  useSavedViews: () => ({
    views: [],
    saveView: vi.fn(),
    deleteView: vi.fn(),
  }),
}));

import CustomersPage from "./CustomersPage";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// Checkboxes render in DOM order: [0] = header "select all", [1..] = per row.
const firstRowCheckbox = () => screen.getAllByRole("checkbox")[1];

describe("CustomersPage row selection", () => {
  it("keeps a customer selected after the search debounce window elapses", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CustomersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(firstRowCheckbox());
    expect(firstRowCheckbox()).toBeChecked();

    // Allow any debounced search emission (the old bug) to fire.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(firstRowCheckbox()).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});
