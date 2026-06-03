import type { ActionDefinition } from "./types";

/**
 * "Internal" actions — app-level steps that DON'T target a device broker.
 * They live outside the device-kind registry (no connection, no `make`),
 * but flow through the same catalog + `runSteps`/`runAction` pipeline under
 * the synthetic kind `internal`. `runAction` special-cases this kind and
 * executes the step itself (see `runInternalAction`), so `toCommand` here is
 * only a passthrough to keep the ActionDefinition shape — it never reaches a
 * broker.
 *
 *   • delay          — wait N ms before the next step in a multi-action
 *                      button, so you can sequence "do A, wait, do B".
 *   • goto-page       — switch the deck the press came from to another page.
 *   • play-scenario   — start a Live Show timeline (from a deck button etc.).
 *   • stop-scenario   — stop the running timeline.
 */
export const INTERNAL_KIND = "internal";

export const INTERNAL_ACTIONS: ActionDefinition[] = [
  {
    id: "delay",
    label: "Delay",
    category: "Internal",
    description: "Pause before the next action in the sequence.",
    bgcolor: "#48484a",
    fgcolor: "#ffffff",
    options: [
      {
        id: "ms",
        type: "number",
        label: "Delay (ms)",
        default: 500,
        min: 0,
        max: 600000,
        step: 50,
      },
    ],
    toCommand: (o) => ({ internal: "delay", ms: Number(o.ms ?? 0) }),
  },
  {
    id: "goto-page",
    label: "Go to page",
    category: "Internal",
    description: "Switch the deck this button is on to another page.",
    bgcolor: "#5856d6",
    fgcolor: "#ffffff",
    options: [
      {
        // Rendered as a dropdown of the operator's pages — the editor injects
        // the live layout list as `choices` (this static list is empty since
        // pages aren't known here). The STORED value is the layout id, so the
        // link survives a page rename; the runner still resolves id-or-name
        // for hand-written / imported configs.
        id: "page",
        type: "dropdown",
        label: "Page",
        choices: [],
      },
    ],
    toCommand: (o) => ({ internal: "goto-page", page: String(o.page ?? "") }),
  },
  {
    id: "play-scenario",
    label: "Play scenario",
    category: "Internal",
    description: "Start a Live Show timeline.",
    bgcolor: "#34c759",
    fgcolor: "#ffffff",
    options: [
      {
        // Dropdown of the operator's scenarios — the editor injects the live
        // scenario list as `choices` (empty here since they aren't known at
        // registration). The STORED value is the scenario id, so the link
        // survives a rename; the runner also resolves id-or-name.
        id: "scenarioId",
        type: "dropdown",
        label: "Scenario",
        choices: [],
      },
      {
        id: "skipWaits",
        type: "boolean",
        label: "Skip waits (play straight through)",
        default: false,
      },
    ],
    toCommand: (o) => ({
      internal: "play-scenario",
      scenarioId: String(o.scenarioId ?? ""),
      skipWaits: Boolean(o.skipWaits),
    }),
  },
  {
    id: "stop-scenario",
    label: "Stop scenario",
    category: "Internal",
    description: "Stop the running Live Show timeline.",
    bgcolor: "#ff3b30",
    fgcolor: "#ffffff",
    toCommand: () => ({ internal: "stop-scenario" }),
  },
];

export function getInternalAction(id: string): ActionDefinition | undefined {
  return INTERNAL_ACTIONS.find((a) => a.id === id);
}
