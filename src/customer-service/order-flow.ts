/** Prepared domain model only: no database writes, public input or AI inference.
 * A future authenticated adapter must verify event evidence before calling this.
 */
export const ORDER_STAGES = [
  "NEW", "EXPLORING", "DESIGN_DIRECTION", "QUALIFIED", "DESIGNER_REVIEW",
  "QUOTED", "DEPOSIT_PENDING", "DEPOSIT_PAID", "DESIGN_REFINEMENT",
  "DESIGN_APPROVED", "IN_PRODUCTION", "FINAL_REVIEW", "REVISION",
  "READY_TO_SHIP", "SHIPPED", "DELIVERED", "AFTERCARE",
] as const;
export type OrderStage = typeof ORDER_STAGES[number];
export type OrderBrief = {
  story?: string;
  format?: string;
  designElements?: string[];
  referenceIds?: string[];
  budgetUsd?: number;
  gemstonePreferences?: string;
  requiredDeliveryDate?: string;
  reviewReasons?: Array<"important_date" | "complex_design" | "substantial_redesign" | "complaint" | "warranty">;
};
export type OrderState = {
  stage: OrderStage;
  designRefinements: number;
  finalAdjustments: number;
  brief: OrderBrief;
};
export type VerifiedOrderEvent = {
  target: OrderStage;
  source: "human" | "shopify" | "workshop" | "courier";
  evidenceId: string;
};
const allowedSources: Record<OrderStage, VerifiedOrderEvent["source"][]> = {
  NEW: [], EXPLORING: ["human"], DESIGN_DIRECTION: ["human"], QUALIFIED: ["human"],
  DESIGNER_REVIEW: ["human"], QUOTED: ["human"], DEPOSIT_PENDING: ["human", "shopify"],
  DEPOSIT_PAID: ["shopify"], DESIGN_REFINEMENT: ["human"], DESIGN_APPROVED: ["human"],
  IN_PRODUCTION: ["workshop"], FINAL_REVIEW: ["workshop"], REVISION: ["human"],
  READY_TO_SHIP: ["workshop"], SHIPPED: ["courier"], DELIVERED: ["courier"], AFTERCARE: ["human"],
};
export function createOrderState(brief: OrderBrief = {}): OrderState {
  return { stage: "NEW", designRefinements: 0, finalAdjustments: 0, brief: structuredClone(brief) };
}
export function transitionOrder(state: OrderState, event: VerifiedOrderEvent): OrderState {
  if (!event.evidenceId.trim() || !allowedSources[event.target]?.includes(event.source)) {
    throw new Error("Verified business evidence from the appropriate source is required");
  }
  const index = ORDER_STAGES.indexOf(state.stage);
  const next = state.stage === "FINAL_REVIEW"
    ? ["REVISION", "READY_TO_SHIP"]
    : [ORDER_STAGES[index + 1]];
  const refinement = state.stage === "DESIGN_REFINEMENT" && event.target === "DESIGN_REFINEMENT";
  if (index < 0 || (!refinement && !next.includes(event.target))) {
    throw new Error("Invalid order transition");
  }
  if (!Number.isInteger(state.designRefinements) || state.designRefinements < 0 || state.designRefinements > 2 ||
      !Number.isInteger(state.finalAdjustments) || state.finalAdjustments < 0 || state.finalAdjustments > 1) {
    throw new Error("Invalid refinement counters");
  }
  if (refinement && state.designRefinements >= 2) throw new Error("Two included design refinements have been used; human scope review required");
  if (event.target === "REVISION" && state.finalAdjustments >= 1) throw new Error("Final adjustment opportunity already used");
  return {
    ...structuredClone(state), stage: event.target,
    designRefinements: state.designRefinements + (refinement ? 1 : 0),
    finalAdjustments: state.finalAdjustments + (event.target === "REVISION" ? 1 : 0),
  };
}
