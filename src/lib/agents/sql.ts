const DATABASE_SCHEMA = `
SQLite tables:

machines
- machine_id
- model
- age

errors
- id
- machine_id
- recorded_at
- error_code

failures
- id
- machine_id
- recorded_at
- component

wafers
- wafer_id
- lot_id

wafer_processing
- processing_id
- wafer_id
- lot_id
- machine_id
- process_start
- process_end
- potentially_exposed
`;
