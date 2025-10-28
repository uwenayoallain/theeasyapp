import { stripQuotes } from "./string-utils";
import { parseNumber as sharedParseNumber } from "./validators";

export type FilterPredicate = (value: unknown) => boolean;

export interface PredicateOptions {
  isNumeric?: boolean;
}

const NUMERIC_TYPE_PATTERNS = /(int|decimal|numeric|float|double|real)/i;
const MAX_SAMPLE_ROWS = 400;
const MAX_SAMPLE_VALUES = 60;

const collator =
  typeof Intl !== "undefined" && typeof Intl.Collator === "function"
    ? new Intl.Collator(undefined, { sensitivity: "base", usage: "search" })
    : null;
const localeCompare = collator
  ? collator.compare.bind(collator)
  : (a: string, b: string) => a.localeCompare(b);

export function inferNumericColumns(
  rows: string[][],
  columns: Array<{ dataType?: string }>,
): boolean[] {
  return columns.map((col, colIndex) => {
    if (col?.dataType && NUMERIC_TYPE_PATTERNS.test(col.dataType)) return true;
    let considered = 0;
    let numeric = 0;
    let scanned = 0;
    for (
      let r = 0;
      r < rows.length &&
      scanned < MAX_SAMPLE_ROWS &&
      considered < MAX_SAMPLE_VALUES;
      r++
    ) {
      const value = rows[r]?.[colIndex];
      scanned++;
      if (value == null) continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      considered++;
      if (parseNumber(trimmed) != null) numeric++;
    }
    if (considered === 0) return false;
    return numeric / considered >= 0.8;
  });
}

export function createFilterPredicate(
  raw: string,
  options: PredicateOptions = {},
): FilterPredicate {
  const text = (raw ?? "").trim();
  if (!text) {
    return () => true;
  }

  const orClauses = splitClauses(text);
  const clausePredicates = orClauses.map((clause) => {
    const tokens = tokenizeClause(clause);
    const tokenPredicates = tokens
      .map((token) => buildTokenPredicate(token, options))
      .filter((predicate): predicate is FilterPredicate => predicate !== null);
    if (tokenPredicates.length === 0) return () => true;
    return (value: unknown) =>
      tokenPredicates.every((predicate) => predicate(value));
  });

  return (value: unknown) =>
    clausePredicates.some((predicate) => predicate(value));
}

function splitClauses(input: string): string[] {
  const orTokens = splitByOperator(input, "||");
  if (orTokens.length > 1) return orTokens;
  const wordOrTokens = splitByOperator(input, " or ");
  return wordOrTokens.length > 1 ? wordOrTokens : [input.trim()];
}

function splitByOperator(input: string, operator: "||" | " or "): string[] {
  const result: string[] = [];
  let buffer = "";
  let quote: '"' | "'" | null = null;
  const lower = operator === " or " ? input.toLowerCase() : input;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '"' || char === "'") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      buffer += char;
      continue;
    }
    if (!quote) {
      if (operator === "||" && char === "|" && input[i + 1] === "|") {
        const trimmed = buffer.trim();
        if (trimmed) result.push(trimmed);
        buffer = "";
        i++;
        continue;
      }
      if (operator === " or " && lower.startsWith(" or ", i)) {
        const before = i === 0 ? " " : lower[i - 1]!;
        const after =
          i + operator.length < lower.length
            ? lower[i + operator.length]!
            : " ";
        if (/\s/.test(before) && /\s/.test(after)) {
          const trimmed = buffer.trim();
          if (trimmed) result.push(trimmed);
          buffer = "";
          i += operator.length - 1;
          continue;
        }
      }
    }
    buffer += char;
  }
  const final = buffer.trim();
  if (final) result.push(final);
  return result.length > 0 ? result : [input.trim()];
}

const COMPARATOR_TOKENS = new Set(["<", "<=", ">", ">=", "=", "!="]);

function tokenizeClause(clause: string): string[] {
  const matches = clause.match(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|&&|[^\s]+/g);
  if (!matches) return [clause.trim()];
  const tokens: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!.trim();
    if (!current || current === "&&") continue;
    if (COMPARATOR_TOKENS.has(current) && i + 1 < matches.length) {
      const next = matches[i + 1]!.trim();
      if (next) {
        tokens.push(`${current} ${next}`);
        i++;
        continue;
      }
    }
    tokens.push(current);
  }
  return tokens.filter(Boolean);
}

function buildTokenPredicate(
  token: string,
  options: PredicateOptions,
): FilterPredicate | null {
  if (!token) return null;
  let text = token;
  let negate = false;
  while (text.startsWith("!")) {
    negate = !negate;
    text = text.slice(1).trim();
  }
  if (!text) {
    return negate ? (value) => !truthy(value) : () => true;
  }

  const predicate =
    buildComparatorPredicate(text, options) ??
    buildRangePredicate(text, options) ??
    buildSpecialPredicate(text) ??
    buildWildcardPredicate(text) ??
    buildContainsPredicate(text);

  return negate ? (value) => !predicate(value) : predicate;
}

function buildComparatorPredicate(
  raw: string,
  options: PredicateOptions,
): FilterPredicate | null {
  const match = raw.match(/^(<=|>=|!=|=|<|>)\s*(.+)$/);
  if (!match) return null;
  const [, op, operandRaw] = match;
  if (operandRaw == null) return null;
  const operandTrimmed = operandRaw.trim();
  if (!operandTrimmed) return null;
  const operandUnquoted = stripQuotes(operandTrimmed);

  const operandNumber = parseNumber(operandUnquoted);
  const prefersNumeric = operandNumber != null || options.isNumeric;
  if (prefersNumeric && operandNumber != null) {
    return (value) => {
      const numeric = parseNumber(asString(value));
      if (numeric == null) return false;
      switch (op) {
        case ">":
          return numeric > operandNumber;
        case ">=":
          return numeric >= operandNumber;
        case "<":
          return numeric < operandNumber;
        case "<=":
          return numeric <= operandNumber;
        case "=":
          return numeric === operandNumber;
        case "!=":
          return numeric !== operandNumber;
        default:
          return false;
      }
    };
  }

  const normalizedOperand = operandUnquoted.toLowerCase();
  switch (op) {
    case "=":
      return (value) => asString(value).toLowerCase() === normalizedOperand;
    case "!=":
      return (value) => asString(value).toLowerCase() !== normalizedOperand;
    case ">":
      return (value) => localeCompare(asString(value), operandUnquoted) > 0;
    case ">=":
      return (value) => localeCompare(asString(value), operandUnquoted) >= 0;
    case "<":
      return (value) => localeCompare(asString(value), operandUnquoted) < 0;
    case "<=":
      return (value) => localeCompare(asString(value), operandUnquoted) <= 0;
    default:
      return null;
  }
}

function buildRangePredicate(
  raw: string,
  options: PredicateOptions,
): FilterPredicate | null {
  if (!options.isNumeric) {
    const maybeNumeric = raw.match(
      /^-?\d+(?:[.,]\d+)?\s*(?:\.\.|…|--?|to)\s*-?\d+(?:[.,]\d+)?$/i,
    );
    if (!maybeNumeric) return null;
  }
  const match = raw
    .replace(/\u2026/g, "..")
    .match(
      /^(-?\d+(?:[.,]\d+)?)\s*(?:\.\.|\s+to\s+|--?|—)\s*(-?\d+(?:[.,]\d+)?)/i,
    );
  if (!match) return null;
  const [, leftRaw, rightRaw] = match;
  if (!leftRaw || !rightRaw) return null;
  const left = parseNumber(leftRaw);
  const right = parseNumber(rightRaw);
  if (left == null || right == null) return null;
  const min = Math.min(left, right);
  const max = Math.max(left, right);
  return (value) => {
    const numeric = parseNumber(asString(value));
    if (numeric == null) return false;
    return numeric >= min && numeric <= max;
  };
}

function buildSpecialPredicate(raw: string): FilterPredicate | null {
  const lower = raw.toLowerCase();
  if (lower === "is:empty" || lower === "is:null") {
    return (value) => asString(value).trim() === "";
  }
  if (lower === "is:notempty" || lower === "is:filled") {
    return (value) => asString(value).trim() !== "";
  }
  return null;
}

function buildWildcardPredicate(raw: string): FilterPredicate | null {
  if (!/[?*]/.test(raw)) return null;
  const pattern = raw
    .split("")
    .map((char) => {
      if (char === "*") return ".*";
      if (char === "?") return ".";
      return escapeRegex(char);
    })
    .join("");
  const regex = new RegExp(`^${pattern}$`, "i");
  return (value) => regex.test(asString(value));
}

function buildContainsPredicate(raw: string): FilterPredicate {
  const text = stripQuotes(raw);
  const lower = text.toLowerCase();
  return (value) => asString(value).toLowerCase().includes(lower);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value))
    return value.toString();
  return String(value ?? "");
}

function parseNumber(value: string): number | null {
  return sharedParseNumber(value);
}

function truthy(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}
