# ProcessIQ

**ProcessIQ** is an educational manufacturing investigation agent built as a Parsity final project. It will correlate machine telemetry, errors, failures, maintenance, and (later) simulated wafer/MES records to produce evidence-backed incident timelines.

## Milestone 1: data foundation

This starter includes a Next.js + TypeScript homepage, a five-table SQLite schema, a public-dataset downloader, an atomic CSV importer, validation scripts, and automated smoke tests. The investigation tools, AI agent, and wafer-tracking workflow are future milestones.

### Requirements

- **Node.js 22.13+** (the importer uses the built-in `node:sqlite` module; Node 22 may display an experimental-feature warning)
- npm

### Quick start (macOS/Linux)

```bash
npm install
npm run data:fetch
npm run db:import
npm run db:verify
npm test
npm run dev
```

Then visit http://localhost:3000.

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

| Table | Approx. rows | Purpose |
|---|---:|---|
| `machines` | 100 | ID, model, age |
| `telemetry` | 876,100 | Hourly volt, rotate, pressure, vibration |
| `errors` | 3,919 | Timestamped nonfatal errors |
| `maintenance` | 3,286 | Component replacements |
| `failures` | 761 | Failure events |

Timestamps are normalized as ISO-style **local/unspecified-zone** strings (`2015-01-01T06:00:00`) so SQL lexical range filters work. The source does not declare a time zone; this app does not pretend those timestamps are UTC. All data resides locally in `data/processiq.sqlite` (gitignored).

`npm run db:verify` prints actual table counts, the recorded telemetry time span, and a machine summary, and checks foreign keys. `npm test` uses small original *test fixtures* rather than downloading the whole dataset. The fixtures are synthetic and are **not** copied from production records.

### Design notes

- The CSV importer checks exact headers, validates numeric values and timestamps, inserts machines before linked data, and uses a staging DB so failed imports do **not** destroy a prior successful import.
- An index on `(machine_id, recorded_at)` supports time-window queries for each event table; telemetry has this as its primary key.
- The public dataset is **simulated industrial machine data**, not real semiconductor records; wafer IDs/MES tracking will be explicitly simulated in a later milestone.
- No OpenAI key is needed for this milestone.

### Next milestone

Implement deterministic read-only query tools:
`getMachineTelemetry(machineId, start, end)`, `getMachineEvents(machineId, start, end)`, and `getFailureHistory(machineId, start, end)`. Add unit tests before connecting OpenAI tool calling.
