import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type { DepartmentSnapshot } from "../testudo/build-department-snapshot.js";
import { compareDepartmentSnapshots } from "../testudo/compare-department-snapshots.js";

export type CompareCliOptions = {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export function parseCompareArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      before: { type: "string" },
      after: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.before) {
    throw new Error("--before is required");
  }
  if (!values.after) {
    throw new Error("--after is required");
  }

  return { before: values.before, after: values.after };
}

export async function runCompare(
  argv: string[],
  options: CompareCliOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  let input: ReturnType<typeof parseCompareArgs>;

  try {
    input = parseCompareArgs(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }

  try {
    const [beforeJson, afterJson] = await Promise.all([
      readFile(input.before, "utf8"),
      readFile(input.after, "utf8"),
    ]);
    const before = JSON.parse(beforeJson) as DepartmentSnapshot;
    const after = JSON.parse(afterJson) as DepartmentSnapshot;
    const comparison = compareDepartmentSnapshots(before, after);

    stdout(JSON.stringify(comparison, null, 2));
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Comparison failed");
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runCompare(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
