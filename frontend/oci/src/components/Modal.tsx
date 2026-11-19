import "./Modal.css";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "./IconButton";

interface ModalProps {
  /** Names the dialog for assistive tech and heads its title row. */
  title: string;
  onClose: () => void;
  /** False while the dialog must not be dismissed (a one-time password not
   * yet saved, #479): Escape and a backdrop click do nothing and the close
   * control is disabled. The dialog's own actions decide when it closes. */
  dismissible?: boolean;
  children: React.ReactNode;
}

/** The app's overlay dialog: a scrim, Escape and backdrop-click to dismiss,
 * focus moved in on open and returned to the opener on close.
 *
 * Deliberately not the native <dialog> element: jsdom 25 (this project's test
 * environment) does not implement showModal(), so a native dialog would be
 * untestable here. */
export function Modal({ title, onClose, dismissible = true, children }: ModalProps): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);

  // Read during the first render, which is the last moment the opener still
  // holds focus: by the time effects run, an autoFocused field inside has it.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    // Content mounts before this effect, so an autoFocused field already holds
    // focus — the panel only takes it when nothing inside did.
    if (panel.current !== null && !panel.current.contains(document.activeElement)) {
      panel.current.focus();
    }
    return () => opener?.focus();
  }, [opener]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (dismissible) {
          onClose();
        }
        return;
      }
      if (event.key !== "Tab" || panel.current === null) {
        return;
      }
      // Tab cycles within the panel: focus must never reach the page behind.
      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, dismissible]);

  return (
    <div
      className="modal-backdrop"
      // Only the scrim itself dismisses — clicks inside the panel bubble here.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) {
          onClose();
        }
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <IconButton
            icon="x"
            label="Close"
            className="modal-close"
            onClick={onClose}
            disabled={!dismissible}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
