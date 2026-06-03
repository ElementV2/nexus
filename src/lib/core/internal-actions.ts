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
 *   • delay     — wait N ms before the next step in a multi-action button,
 *                 so you can sequence "do A, wait, do B" on one key.
 *   • goto-page — switch the deck the press came from to another page.
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
];

export function getInternalAction(id: string): ActionDefinition | undefined {
  return INTERNAL_ACTIONS.find((a) => a.id === id);
}
