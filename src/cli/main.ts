import { readFileSync, writeFileSync } from "node:fs";
import { cliRun } from "./run";

/**
 * The command line: `asciigraph render diagram.mmd`. Everything it does is in run.ts (pure, so
 * the tests can call it); this file only touches the process.
 */
function readInput(file: string | null): string {
  return readFileSync(file === null || file === "-" ? 0 : file, "utf8");
}

const result = cliRun(process.argv.slice(2), {
  read: readInput,
  write: (file, text) => writeFileSync(file, text),
});
if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : result.stdout + "\n");
if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : result.stderr + "\n");
process.exitCode = result.code;
