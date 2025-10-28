export interface ColumnMeta {
  name: string;
  type: string;
}

export interface ColumnDef {
  name: string;
  width?: number;
  dataType?: string;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  colIndex: number;
  dir: SortDirection;
}
