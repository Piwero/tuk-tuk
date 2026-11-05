import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

// jsdom's location/history persists across tests within a file — reset it so
// a pushState left over from one test (e.g. clicking Calendar) never leaks
// into the next test's initial render (issue #143's URL routing reads
// window.location.pathname on mount).
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

// jsdom has no PointerEvent; without it `fireEvent.pointerMove(el, { clientX })` and user-event's
// pointer actions lose their coordinates and pointer type.
if (typeof window.PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  window.PointerEvent = PointerEvent as unknown as typeof window.PointerEvent;
}

// jsdom has no WebGL; the Aura visualizer is a shader, so tests see a marker that exposes the
// props the app gives it instead.
vi.mock("../components/agents-ui/agent-audio-visualizer-aura", () => ({
  AgentAudioVisualizerAura: (props: {
    state?: string;
    color?: string;
    colorShift?: number;
    themeMode?: string;
    size?: string;
  }) => (
    <div
      data-testid="aura"
      data-state={props.state}
      data-color={props.color}
      data-color-shift={props.colorShift}
      data-theme-mode={props.themeMode}
      data-size={props.size}
    />
  ),
}));
