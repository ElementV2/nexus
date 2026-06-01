import { registerFeedback, disconnectedOverride } from "@/lib/core/feedback";

/**
 * Connectivity-only feedback for kinds without rich rules yet (grandMA3 /
 * grandMA2): dim the key when the connection isn't healthy, so a key that
 * fires into a dropped console reads as inactive rather than live. Pure.
 */
registerFeedback("grandma3", (_action, _opts, vars) =>
  disconnectedOverride(vars)
);
registerFeedback("grandma2", (_action, _opts, vars) =>
  disconnectedOverride(vars)
);
