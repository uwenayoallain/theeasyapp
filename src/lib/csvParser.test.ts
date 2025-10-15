import { test, expect } from "bun:test";
import { parseCSV } from "./csvParser";

test("parseCSV handles escaped quotes and CRLF", () => {
  const input = 'a,b\r\n"he""llo",2\r\n3,4\r\n';
  const out = parseCSV(input);
  expect(out.columns.map(c => c.name)).toEqual(["a", "b"]);
  expect(out.rows).toEqual([["he\"llo", "2"], ["3", "4"]]);
});

test("parseCSV skips empty lines", () => {
  const input = 'a,b\n1,2\n\n3,4\n';
  const out = parseCSV(input);
  expect(out.rows).toEqual([["1", "2"], ["3", "4"]]);
});
