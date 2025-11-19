import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";
import { parseExcelFile } from "@/lib/excelParser";

function workbookToFile(wb: XLSX.WorkBook, name = "test.xlsx"): File {
  const array = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([array], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("excel parser", () => {
  test("parses basic worksheet into columns and rows", async () => {
    const wsData = [
      ["city", "temp"],
      ["Paris", 72],
      ["Rome", 81],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

    const file = workbookToFile(wb);
    const result = await parseExcelFile(file);

    expect(result.columns.map((c) => c.name)).toEqual(["city", "temp"]);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]).toEqual(["Paris", "72"]);
  });
});
