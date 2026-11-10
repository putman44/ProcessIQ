# ProcessIQ

**ProcessIQ** is an educational manufacturing investigation application built as a Parsity final project. It combines the Microsoft Azure Predictive Maintenance dataset with clearly labeled synthetic semiconductor manufacturing records for evidence-backed incident timelines.

## Data foundation

The project includes a Next.js + TypeScript homepage, SQLite schema, public-dataset downloader, atomic CSV importer, deterministic wafer generator, six read-only investigation tools, an OpenAI tool-calling API, validation scripts, and automated tests.

### Requirements

- **Node.js 22.13+** (the importer uses the built-in `node:sqlite` module; Node 22 may display an experimental-feature warning)
- npm

### Quick start (macOS/Linux)

```bash
npm install
npm run data:fetch
npm run db:import
npm run data:generate-wafers
npm run db:verify
npm test
npm run dev
```

Then visit http://localhost:3000.

For the investigation API, copy `.env.example` to `.env.local`, set `OPENAI_API_KEY` to your key, and optionally change `OPENAI_MODEL` (default `gpt-4.1-mini`). Both variables are server-side; `.env.local` is gitignored. Restart the dev server after changing them. The homepage is still a placeholder; use the API directly.

If the Azure download is unavailable, manually place the following five files in `data/raw/` and run `npm run db:import`:

- `PdM_machines.csv`
- `PdM_telemetry.csv`
- `PdM_errors.csv`
- `PdM_maint.csv`
- `PdM_failures.csv`

Primary dataset location: `https://azuremlsampleexperiments.blob.core.windows.net/datasets/PdM_telemetry.csv` (and the same directory for the remaining CSV filenames). See [Microsoft SQL workshops predictive-maintenance notebook](https://github.com/microsoft/sqlworkshops/blob/master/SQLServerAndAzureMachineLearning/ML%20Services%20for%20SQL%20Server/notebooks/Predictive%20Maintenance%20in%20Python%20Notebook.ipynb).

You can also use the [Kaggle mirror](https://www.kaggle.com/datasets/arnabbiswas1/microsoft-azure-predictive-maintenance).

### Import verification

The public data contains approximately:

| Table         | Approx. rows | Purpose                                  |
| ------------- | -----------: | ---------------------------------------- |
| `machines`    |          100 | ID, model, age                           |
| `telemetry`   |      876,100 | Hourly volt, rotate, pressure, vibration |
| `errors`      |        3,919 | Timestamped nonfatal errors              |
| `maintenance` |        3,286 | Component replacements                   |
| `failures`    |          761 | Failure events                           |

Timestamps are normalized as ISO-style **local/unspecified-zone** strings (`2015-01-01T06:00:00`) so SQL lexical range filters work. The source does not declare a time zone; this app does not pretend those timestamps are UTC. All data resides locally in `data/processiq.sqlite` (gitignored).

`npm run db:verify` prints source and synthetic counts and checks foreign keys, time bounds, lot membership, machine and wafer scheduling, and machine-event exposure flags. `npm test` uses small synthetic fixtures rather than downloading the whole dataset. The fixtures are **not** copied from production records.

### Synthetic manufacturing model

| Table                     | Full-dataset rows | Relationship                                                |
| ------------------------- | ----------------: | ----------------------------------------------------------- |
| `manufacturing_lots`      |               500 | Five wafers per lot                                         |
| `wafers`                  |             2,500 | One lot per wafer                                           |
| `operators`               |                40 | Synthetic personnel identifiers                             |
| `wafer_processing`        |            10,000 | Four ordered steps per wafer, each on a different machine   |
| `operator_incident_notes` |          Up to 80 | Machine event notes, optionally linked to a processing step |

Every generated table has `is_synthetic = 1`, and generated IDs use the `SYN-` prefix. `wafer_processing.processing_id` identifies a **step**, while `wafer_id` identifies the wafer across steps. A composite foreign key from `(wafer_id, lot_id)` to `wafers` prevents a step from claiming the wrong lot. Operator, machine, and optional note-to-processing links also use foreign keys. Machine/time, wafer/time, lot, and note machine/time indexes support investigation queries.

The generator uses seed `20251109` by default; pass `-- --seed 12345` to select another seed. It creates 25 nonoverlapping single-wafer windows per machine in each of four consecutive periods across the source telemetry range. Durations are 30–120 minutes, except one-hour windows anchored to selected source errors and failures. A wafer's four steps occur in time order on four different machines. `potentially_exposed = 1` means a source machine error or failure timestamp fell within that processing window. It **does not** mean the wafer was defective. Notes describe synthetic observations and do not assert a quality outcome.

Run `npm run data:generate-wafers` after importing. On an existing database, the command adds the manufacturing tables and replaces only their generated rows in one transaction; it does not delete or rewrite `machines`, `telemetry`, `errors`, `maintenance`, or `failures`. Repeating the same seed produces the same logical rows without duplicates. Re-running `db:import` builds a new database from the original CSVs, so run the wafer command again afterward. For a different database path, use `npm run data:generate-wafers -- --db /path/to/database.sqlite`.

### Design notes

- The CSV importer checks exact headers, validates numeric values and timestamps, inserts machines before linked data, and uses a staging DB so failed imports do **not** destroy a prior successful import.
- An index on `(machine_id, recorded_at)` supports time-window queries for each event table; telemetry has this as its primary key.
- The public dataset is **simulated industrial machine data**, not actual semiconductor fab data. It remains in the five original tables. All lot, wafer, operator, processing, and incident-note records are generated synthetic data.
- The OpenAI key is needed only for `/api/investigate`; data import, direct tools, tests, and typechecking run offline.

### Investigation tools

`openInvestigation(dbPath?)` in `src/lib/investigation.ts` opens a SQLite database read-only. Its methods return plain JSON-compatible objects:

| Method                                                      | Result                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getMachineTelemetry(machineId, startTime, endTime)`        | Up to 1,000 chronological readings and count/min/max/average for volt, rotate, pressure, vibration; a `truncated` flag indicates more rows. Windows are capped at 31 days.                                                                       |
| `getMachineEvents(machineId, startTime, endTime)`           | Chronological source errors and maintenance, with type, source ID, timestamp, and detail.                                                                                                                                                        |
| `getFailureHistory(machineId, startTime?, endTime?)`        | Source failures and failed components, with optional bounds.                                                                                                                                                                                     |
| `getWaferHistory(waferId)`                                  | Synthetic wafer and lot plus chronological processing steps, machines, operators, windows, and statuses.                                                                                                                                         |
| `getAffectedWafers(machineId, startTime, endTime)`          | Synthetic processing records overlapping the incident window, plus source errors/failures within both windows and a potential-exposure status. This never asserts a wafer defect.                                                                |
| `getIncidentNotes(machineId, startTime, endTime, waferId?)` | Synthetic operator notes with note ID, timestamp, operator ID/name, note text, and optional directly linked processing/wafer ID. A wafer filter returns only notes linked through `processing_id`; unlinked notes cannot be assigned to a wafer. |

Every time window is **start-inclusive, end-exclusive** (`[startTime, endTime)`). Inputs accept `YYYY-MM-DD HH:mm:ss` or normalized `YYYY-MM-DDTHH:mm:ss`; output uses the latter. These are source-local timestamps with no declared timezone. Missing records return `null` metadata and empty arrays. Pass a positive integer machine ID and a synthetic wafer ID such as `SYN-WAF-00001`.

Example (Node 22.13+ with TypeScript loading support):

```js
import { openInvestigation } from "./src/lib/investigation.ts";
const investigation = openInvestigation("data/processiq.sqlite");
try {
  const events = investigation.getMachineEvents(
    1,
    "2015-01-03T06:00:00",
    "2015-01-03T08:00:00",
  );
  const wafers = investigation.getAffectedWafers(
    1,
    "2015-01-03T06:00:00",
    "2015-01-03T08:00:00",
  );
  console.log({ events, wafers });
} finally {
  investigation.close();
}
```

### Investigation API

Send a natural-language question to `POST /api/investigate`:

```bash
curl -sS http://localhost:3000/api/investigate \
  -H 'Content-Type: application/json' \
  -d '{"question":"For Machine 1 between 2015-01-03T06:30:00 and 2015-01-03T08:00:00, explain the recorded machine events and identify potentially exposed wafers."}'
```

The JSON response contains `answer`, `evidence` (source type/ID, original-or-synthetic origin, machine ID, timestamp), `uncertainty`, and `tool_use` (tool name, status, result count, truncation). The agent calls the six named read-only functions on the server; it cannot issue SQL. Tool arguments and timestamps are checked server-side. Queries are limited to 31-day windows, tool results are bounded, and an investigation can make at most 12 calls over four tool rounds. The answer must reference records returned by tools. Notes are untrusted data, and source machine records are distinguished from synthetic manufacturing records. Potential wafer exposure is not a confirmed defect or causal finding.

The API returns 400 for malformed questions, 413 for oversized requests, 503 when the key is missing, and 502 if model execution or evidence validation fails. The tests mock model responses and do not contact OpenAI. A live OpenAI integration check requires a configured key and a separate API request.
