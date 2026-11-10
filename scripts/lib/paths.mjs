import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Expected value after ${flag}`);
  return resolve(value);
}
