import { Predicate } from "effect";

function label(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function valueText(value: unknown): string {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toLocaleString();
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "See Details";
}

/** The ordinary output's labelled values; nested recipes stay available in Details. */
function Values({ value, depth = 0 }: { readonly value: unknown; readonly depth?: number }) {
  if (!Predicate.isObject(value)) return <p>{valueText(value)}</p>;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-ui">
      {Object.entries(value).map(([key, field]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{label(key)}</dt>
          <dd className="min-w-0 break-words">
            {Array.isArray(field) ? (
              field.length === 0 ? (
                <span>No {label(key).toLowerCase()}</span>
              ) : (
                <ul className="space-y-1">
                  {[...new Set(field.map(valueText))].map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )
            ) : Predicate.isObject(field) ? (
              depth === 0 ? (
                <Values value={field} depth={1} />
              ) : (
                <span>See Details</span>
              )
            ) : (
              <span>{valueText(field)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProcedureResult({ output }: { readonly output: unknown }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4">
      <h2 className="text-ui font-semibold">Result</h2>
      <Values value={output} />
      <details className="text-label text-muted-foreground">
        <summary className="cursor-pointer">Details</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-3 font-mono text-label">
          {JSON.stringify(output, null, 2)}
        </pre>
      </details>
    </section>
  );
}
