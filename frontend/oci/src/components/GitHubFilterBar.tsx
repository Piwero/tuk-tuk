import "./GitHubFilterBar.css";

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
  // A Repository View's saved choice (#580) stays offered even when
  // nothing open matches it any more.
  const offered = value === null || choices.includes(value) ? choices : [value, ...choices];
  return (
    <label className="github-filter">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{anyLabel}</option>
        {offered.map((choice) => (
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
  tab,
  items,
  filters,
  onChange,
}: {
  /** Which tab the controls narrow: only GitHub Issues have assignees. */
  tab: "pull-requests" | "issues";
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
      {tab === "issues" && (
        <FilterSelect
          label="Assignee"
          anyLabel="Anyone"
          value={filters.assignee}
          choices={choices.assignees}
          onChange={(assignee) => onChange({ ...filters, assignee })}
        />
      )}
      {tab === "pull-requests" && (
        <label className="github-filter-toggle">
          <input
            type="checkbox"
            checked={filters.hideDrafts}
            onChange={(event) => onChange({ ...filters, hideDrafts: event.target.checked })}
          />
          <span>Hide drafts</span>
        </label>
      )}
      <label className="github-filter-toggle">
        <input
          type="checkbox"
          checked={filters.hideBots}
          onChange={(event) => onChange({ ...filters, hideBots: event.target.checked })}
        />
        <span>Hide bots</span>
      </label>
    </div>
  );
}
