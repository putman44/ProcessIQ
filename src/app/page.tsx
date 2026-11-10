const sources = [
  { name: "Machine metadata", dataset: "PdM_machines.csv", details: "Machine ID, model, age" },
  { name: "Telemetry", dataset: "PdM_telemetry.csv", details: "Hourly voltage, rotation, pressure, vibration" },
  { name: "Error events", dataset: "PdM_errors.csv", details: "Timestamped machine error codes" },
  { name: "Maintenance", dataset: "PdM_maint.csv", details: "Component replacement history" },
  { name: "Failures", dataset: "PdM_failures.csv", details: "Recorded component failures" },
];

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <span className="brand">Process<span className="brand-accent">IQ</span></span>
        <span className="status">Milestone 1 · Data foundation</span>
      </header>
      <section className="hero">
        <p className="eyebrow">MANUFACTURING INTELLIGENCE</p>
        <h1>From scattered machine records to clear investigations.</h1>
        <p className="lede">A Parsity final project built around equipment telemetry, machine events, and evidence-backed incident timelines.</p>
      </section>
      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">STEP 1</p>
            <h2>Data sources</h2>
          </div>
          <span className="muted">Azure predictive maintenance sample</span>
        </div>
        <div className="sources">
          {sources.map((item) => (
            <div className="source" key={item.dataset}>
              <div><strong>{item.name}</strong><p>{item.details}</p></div>
              <code>{item.dataset}</code>
            </div>
          ))}
        </div>
      </section>
      <section className="next">
        <h2>Get the data ready</h2>
        <p>In a terminal, run these commands from the project folder. Data is stored locally in SQLite and is not committed to GitHub.</p>
        <pre><code>{`npm run data:fetch\nnpm run db:import\nnpm run db:verify`}</code></pre>
        <p className="footnote">The investigation UI and AI tool calling are coming in later milestones. The sample data is simulated and is not real wafer-level MES data.</p>
      </section>
    </main>
  );
}
