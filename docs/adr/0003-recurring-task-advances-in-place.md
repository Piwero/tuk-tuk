# Recurring tasks advance in place; completion writes an occurrence record

Completing a recurring task does NOT set its status to completed. Instead, the task row keeps its RRULE and its dates roll forward to the next occurrence, while a separate Completed Occurrence record is written so the completed view and statistics retain history. A task row only reaches completed status when it has no recurrence (or its recurrence has ended).

This keeps "the series" a single editable row. The alternative — spawning a fresh task row per occurrence — makes per-occurrence queries trivial but scatters series edits across rows; we rejected it.

Consequence: any code that equates "user checked the box" with "status = completed" is wrong for recurring tasks; completion logic must branch on the presence of a recurrence rule.
