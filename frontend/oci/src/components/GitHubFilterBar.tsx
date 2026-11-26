import { type Filterable, type GitHubFilters, githubFilterChoices } from "../githubFilters";

/** One choice among the values present in the results, or none. */
function FilterSelect({
  label,
  anyLabel,
  value,
  choices,
  onChange,
}: {
  label: string;
  anyLabel: string;
  value: string | null;
  choices: string[];
  onChange: (value: string | null) => void;
}): React.JSX.Element {
  return (
    <label className="github-filter">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{anyLabel}</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The GitHub view's filter controls (#585). Controlled: the owner holds the
 * filters and decides whether they outlive the view. */
export function GitHubFilterBar({
  items,
  filters,
  onChange,
}: {
  /** The tab's unfiltered results: the choices come from them. */
  items: Filterable[];
  filters: GitHubFilters;
  onChange: (filters: GitHubFilters) => void;
}): React.JSX.Element {
  const choices = githubFilterChoices(items);
  return (
    <div role="group" aria-label="Filters" className="github-filters">
      <FilterSelect
        label="Author"
        anyLabel="Anyone"
        value={filters.author}
        choices={choices.authors}
        onChange={(author) => onChange({ ...filters, author })}
      />
      <FilterSelect
        label="Label"
        anyLabel="Any label"
        value={filters.label}
        choices={choices.labels}
        onChange={(label) => onChange({ ...filters, label })}
      />
    </div>
  );
}
