import { useState } from "react";
import type { AiRuleSource } from "digipology-protocol/http";
import { readRuleSourceFiles, ruleSourceBytes, ruleSourceHash } from "./ruleSources";

export function RuleSourcePicker({ sources, disabled, onChange, onReading }: {
  sources: readonly AiRuleSource[];
  disabled: boolean;
  onChange(sources: AiRuleSource[]): void;
  onReading(reading: boolean): void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <fieldset className="rule-sources" disabled={disabled || reading}>
    <legend>Rulebooks and card lists <small>(optional)</small></legend>
    <p>Attach complete rules and card data as text, Markdown or CSV. Up to 8 files, 128 KiB together. Source text is sent with your request and stays separate from the playable release.</p>
    <label htmlFor="ai-rule-files">Attach rule or card files</label>
    <input id="ai-rule-files" type="file" multiple accept=".md,.markdown,.txt,.csv,.tsv,text/plain,text/markdown,text/csv" onChange={(event) => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
      if (!files.length) return;
      setReading(true); onReading(true); setError(null);
      void readRuleSourceFiles(files, sources).then(onChange).catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : "The source files could not be read. Your existing documents are preserved.");
      }).finally(() => { setReading(false); onReading(false); });
    }} />
    {reading ? <p role="status">Reading complete source files…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {sources.length ? <ul aria-label="Attached source documents">{sources.map((source, index) => <li key={source.name}>
      <div className="rule-sources__heading"><strong>{source.name}</strong><button type="button" className="secondary-button" aria-label={`Remove ${source.name}`} onClick={() => { onChange(sources.filter((_, at) => at !== index)); setError(null); }}>Remove</button></div>
      <small>{ruleSourceBytes(source.text).toLocaleString()} bytes · complete text</small>
      <details><summary>Source fingerprint</summary><code>{ruleSourceHash(source.text)}</code></details>
      <label>Public source URL <small>(optional)</small><input type="url" maxLength={2048} placeholder="https://…" value={source.sourceUrl ?? ""} onChange={(event) => {
        const { sourceUrl: _old, ...document } = source;
        const sourceUrl = event.currentTarget.value;
        onChange(sources.map((item, at) => at !== index ? item : { ...document, ...(sourceUrl ? { sourceUrl } : {}) }));
      }} /></label>
    </li>)}</ul> : null}
  </fieldset>;
}
