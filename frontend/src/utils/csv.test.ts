import { describe, it, expect } from "vitest";
import { rowsToCsv, type CsvColumn } from "./csv";

interface Row {
  a: string;
  b: number | null;
}

describe("rowsToCsv", () => {
  const columns: CsvColumn<Row>[] = [
    { header: "A", value: (r) => r.a },
    { header: "B", value: (r) => r.b },
  ];

  it("serializes a header row and data rows", () => {
    const csv = rowsToCsv([{ a: "x", b: 1 }], columns);
    expect(csv).toBe("A,B\nx,1");
  });

  it("quotes and escapes commas, quotes, and newlines", () => {
    const csv = rowsToCsv([{ a: 'a,"b"\nc', b: 2 }], columns);
    expect(csv).toBe('A,B\n"a,""b""\nc",2');
  });

  it("renders null/undefined values as empty cells", () => {
    const csv = rowsToCsv([{ a: "x", b: null }], columns);
    expect(csv).toBe("A,B\nx,");
  });
});
