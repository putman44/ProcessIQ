import { mkdir, writeFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { projectRoot, getArg } from "./lib/paths.mjs";

const outputDir = getArg("--data-dir", join(projectRoot, "data/raw"));
const baseUrl = "https://azuremlsampleexperiments.blob.core.windows.net/datasets";
const filenames = ["PdM_machines.csv", "PdM_telemetry.csv", "PdM_errors.csv", "PdM_maint.csv", "PdM_failures.csv"];
await mkdir(outputDir, { recursive: true });

for (const name of filenames) {
  const file = join(outputDir, name);
  try {
    const info = await stat(file);
    if (info.size > 0) {
      console.log(`Already present: ${name} (${info.size.toLocaleString()} bytes)`);
      continue;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(`Fetching ${name}...`);
  const temp = file + ".download";
  try {
    const response = await fetch(`${baseUrl}/${name}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${name}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error(`Empty response for ${name}`);
    await writeFile(temp, bytes);
    await rename(temp, file);
    console.log(`Saved ${name} (${bytes.length.toLocaleString()} bytes)`);
  } catch (error) {
    await rm(temp, { force: true });
    console.error(`Could not download ${name}: ${error.message}`);
    console.error(`Alternative: manually download the five PdM_*.csv files into ${outputDir}.`);
    process.exitCode = 1;
    break;
  }
}
