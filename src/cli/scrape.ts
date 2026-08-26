import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { ingestDepartment } from "../testudo/ingest-department.js";

export type ScrapeCliOptions = {
  ingest?: typeof ingestDepartment;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
};

export function parseScrapeArgs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      semester: { type: "string" },
      department: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.semester) {
    throw new Error("--semester is required");
  }
  if (!values.department) {
    throw new Error("--department is required");
  }
  if (!/^\d{6}$/.test(values.semester)) {
    throw new Error("semester must contain exactly six digits");
  }
  if (!/^[A-Za-z]{4}$/.test(values.department)) {
    throw new Error("department must contain exactly four ASCII letters");
  }

  return {
    semester: values.semester,
    department: values.department.toUpperCase(),
  };
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export async function runScrape(
  argv: string[],
  options: ScrapeCliOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  let input: ReturnType<typeof parseScrapeArgs>;

  try {
    input = parseScrapeArgs(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Invalid arguments");
    return 2;
  }

  try {
    const result = await (options.ingest ?? ingestDepartment)(input);
    const summary = result.snapshot.summary;
    stdout(
      `Wrote ${result.path} (${countLabel(summary.coursesParsed, "course")}, ${countLabel(summary.sectionsParsed, "section")})`,
    );

    if (result.snapshot.status === "partial") {
      stderr(
        `Snapshot is partial: ${countLabel(summary.coursesFailed, "course")} failed`,
      );
      return 1;
    }

    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Scrape failed");
    return 1;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runScrape(process.argv.slice(2));
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void main();
}
