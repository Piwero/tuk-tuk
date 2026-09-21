import { useHoverHint } from "../useHoverHint";
import { Hint, type HintKey } from "./Hint";
import { Icon, type IconName } from "./Icon";

interface IconButtonProps {
  icon: IconName;
  /** Serves as both the accessible name (`aria-label`) and the visible
   * hover/focus hint — one string, so the two can't drift apart (#261). */
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  size?: number;
  type?: "button" | "submit";
  "aria-pressed"?: boolean;
  "aria-expanded"?: boolean;
  disabled?: boolean;
  /** Appends a registry explanation below the name hint — e.g. Archive
   * distinguishing itself from Delete (#261 story 11). Delegates entirely
   * to `Hint` (session suppression, destructive bypass, description
   * wiring included) rather than re-implementing any of it here. */
  descriptionKey?: HintKey;
  /** Passed straight through to the wrapping `Hint` when `descriptionKey`
   * is set — Archive-grade controls keep explaining themselves even after
   * being read once (#261). No-op without `descriptionKey`. */
  destructive?: boolean;
}

/** A button whose only content is a glyph. Owns the whole contract: the
 * glyph is `aria-hidden`, `label` is the accessible name, and hovering or
 * focusing the control surfaces that same name as a visible hint (#261) —
 * the drift between a hand-rolled `aria-label` and an absent hover hint
 * that motivated this component in the first place. */
export function IconButton({
  icon,
  label,
  onClick,
  className,
  size,
  type = "button",
  descriptionKey,
  destructive,
  disabled,
  ...rest
}: IconButtonProps): JSX.Element {
  const { open, handlers } = useHoverHint();
  const button = (
    <button
      type={type}
      className={className}
      aria-label={label}
      aria-pressed={rest["aria-pressed"]}
      aria-expanded={rest["aria-expanded"]}
      disabled={disabled}
      onClick={onClick}
      {...handlers}
    >
      <Icon name={icon} size={size} />
    </button>
  );
  return (
    <span className="icon-button-wrap">
      {descriptionKey === undefined ? (
        button
      ) : (
        <Hint hintKey={descriptionKey} destructive={destructive}>
          {button}
        </Hint>
      )}
      {open && (
        <span role="tooltip" className="icon-button-hint">
          {label}
        </span>
      )}
    </span>
  );
}
