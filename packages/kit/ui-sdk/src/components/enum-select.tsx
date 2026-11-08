export interface EnumOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A `<select>` over a closed set, where the option list is also the decoder.
 *
 * The DOM hands a change event back as a bare `string`; every caller used to
 * assert it into its own union. Here the list that rendered the options is the
 * list that resolves the change, so `onChange` receives a member of the set and
 * anything else is a no-op.
 */
export function EnumSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  testId,
  id,
}: {
  value: T;
  options: readonly EnumOption<T>[];
  onChange: (next: T) => void;
  className?: string;
  testId?: string;
  /** The element's id, so a `<label htmlFor>` names it. */
  id?: string;
}) {
  return (
    <select
      id={id}
      className={className}
      value={value}
      data-testid={testId}
      onChange={(e) => {
        const picked = options.find((o) => o.value === e.target.value);
        if (picked !== undefined) onChange(picked.value);
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
