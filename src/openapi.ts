/**
 * Single source of truth for the StableRoute Backend OpenAPI document.
 *
 * The spec is authored in `openapi.yaml` at the repository root so it can be
 * linted and validated by standard tooling in CI (e.g. `swagger-cli validate`).
 * This module reads that file at startup, parses it with a built-in YAML parser,
 * and exports the result so `GET /api/v1/openapi.json` always serves the
 * canonical, file-defined spec — never a stale in-memory copy.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Minimal YAML parser — handles the subset of YAML used in openapi.yaml
// (mappings, sequences, scalars, quoted strings, block-nested structures).
// No third-party dependency is required.
// ---------------------------------------------------------------------------

function parseYamlValue(text: string): unknown {
  const src = text.replace(/^﻿/, ""); // strip BOM
  const lines = src.split(/\r?\n/);
  return parseMapping(lines, 0, 0).value;
}

type ParseResult = { value: unknown; next: number };

function skipBlanks(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t !== "" && !t.startsWith("#")) return i;
    i++;
  }
  return i;
}

function lineIndent(line: string): number {
  const exp = line.replace(/\t/g, "  ");
  return exp.length - exp.trimStart().length;
}

function lineContent(line: string): string {
  return line.replace(/\t/g, "  ").trimStart();
}

function parseBlock(lines: string[], start: number, _baseIndent: number): ParseResult {
  const i = skipBlanks(lines, start);
  if (i >= lines.length) return { value: null, next: i };
  const content = lineContent(lines[i]);
  if (content.startsWith("- ") || content === "-") {
    return parseSequence(lines, i, lineIndent(lines[i]));
  }
  return parseMapping(lines, i, lineIndent(lines[i]));
}

function parseMapping(lines: string[], start: number, indent: number): ParseResult {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (t === "" || t.startsWith("#")) { i++; continue; }
    const ind = lineIndent(raw);
    if (ind < indent) break;
    if (ind > indent) { i++; continue; }
    const content = lineContent(raw);
    const colon = content.indexOf(":");
    if (colon < 0) { i++; continue; }
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).replace(/#[^'"]*$/, "").trim();
    if (rest === "" || rest.startsWith("|") || rest.startsWith(">")) {
      i++;
      const j = skipBlanks(lines, i);
      if (j >= lines.length || lineIndent(lines[j]) <= indent) {
        obj[key] = null;
        i = j;
        continue;
      }
      const childIndent = lineIndent(lines[j]);
      const sub = parseBlock(lines, j, childIndent);
      obj[key] = sub.value;
      i = sub.next;
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }
  return { value: obj, next: i };
}

function parseSequence(lines: string[], start: number, indent: number): ParseResult {
  const arr: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    if (t === "" || t.startsWith("#")) { i++; continue; }
    const ind = lineIndent(raw);
    if (ind < indent) break;
    if (ind > indent) { i++; continue; }
    const content = lineContent(raw);
    if (!content.startsWith("- ") && content !== "-") { i++; continue; }
    const after = content.slice(2).trim();
    if (after === "" || after.startsWith("#")) {
      i++;
      const j = skipBlanks(lines, i);
      if (j >= lines.length || lineIndent(lines[j]) <= indent) {
        arr.push(null);
        i = j;
        continue;
      }
      const sub = parseBlock(lines, j, lineIndent(lines[j]));
      arr.push(sub.value);
      i = sub.next;
    } else if (after.includes(": ") || after.endsWith(":")) {
      const fakeIndent = indent + 2;
      const fakeLines = [" ".repeat(fakeIndent) + after];
      let k = i + 1;
      while (k < lines.length) {
        const nxt = lines[k].replace(/\t/g, "  ");
        const ni = nxt.length - nxt.trimStart().length;
        if (nxt.trim() === "" || nxt.trim().startsWith("#")) { fakeLines.push(""); k++; continue; }
        if (ni <= indent) break;
        fakeLines.push(nxt);
        k++;
      }
      const sub = parseMapping(fakeLines, 0, fakeIndent);
      arr.push(sub.value);
      i = k;
    } else {
      arr.push(parseScalar(after.replace(/#[^'"]*$/, "").trim()));
      i++;
    }
  }
  return { value: arr, next: i };
}

function parseScalar(s: string): unknown {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (/^-?[0-9]+$/.test(s)) return parseInt(s, 10);
  if (/^-?[0-9]*\.[0-9]+$/.test(s)) return parseFloat(s);
  return s;
}

// ---------------------------------------------------------------------------
// Load and export the parsed spec
// ---------------------------------------------------------------------------

const YAML_PATH = join(__dirname, "..", "openapi.yaml");

/**
 * The parsed OpenAPI document derived from `openapi.yaml`. Exported for the
 * `/api/v1/openapi.json` handler and for tests that assert spec correctness.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const openApiSpec: Record<string, any> = (() => {
  const raw = readFileSync(YAML_PATH, "utf8");
  return parseYamlValue(raw) as Record<string, unknown>;
})();
