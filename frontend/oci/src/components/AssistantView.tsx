/** The Assistant's view (ADR 0009). Only ever reached while
 * `useAssistantAvailable` reports true — App.tsx doesn't render the nav
 * item that leads here otherwise (issue #185). The conversation itself —
 * chat, Suggestion cards, the apply path — is issue #188; this is the
 * placeholder the gate lands on until then. */
export function AssistantView(): JSX.Element {
  return (
    <div className="assistant-view">
      <p className="settings-hint">The Assistant is configured and ready.</p>
    </div>
  );
}
