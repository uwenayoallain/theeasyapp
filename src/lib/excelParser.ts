import type { ColumnDef } from "./csv";

export interface ParsedExcel {
  columns: ColumnDef[];
  rows: string[][];
}

export async function parseExcelFile(file: File): Promise<ParsedExcel> {
  try {
    const XLSX = await import("xlsx");
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error("Excel file has no sheets");
    }

    const worksheet = workbook.Sheets[firstSheetName];
    if (!worksheet) {
      throw new Error("Could not read Excel sheet");
    }

    const data = XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][];

    if (data.length === 0) {
      return { columns: [], rows: [] };
    }

    const headers = data[0] || [];
    const columns: ColumnDef[] = headers.map((name, index) => ({
      name: name?.trim() || `Column ${index + 1}`,
      width: 160,
    }));

    const rows = data.slice(1);
    return { columns, rows };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot find module")) {
      throw new Error(
        "Excel support requires the 'xlsx' package. Please run: bun add xlsx"
      );
    }
    throw error;
  }
}
