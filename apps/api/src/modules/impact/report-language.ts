/**
 * How a figure is said in a sentence (IMP-22).
 *
 * Kept apart from the report service because this is the only place in
 * MaybeOS that writes prose a funder will read, and it should be easy to find
 * and argue with. Each phrase states what was measured and leaves the
 * interpretation to the reader — "members rated their sense of belonging 3.8
 * out of 5", never "belonging is strong".
 *
 * That restraint is the PRD's own rule: no causal claims, no evaluation
 * language. A co-op that says "we increased belonging" in a grant application
 * on the strength of twelve micro-questions has been let down by its tools.
 */
export const CATEGORY_PHRASE: Record<string, (value: string) => string> = {
  belonging: (v) => `Members rated how much they feel they belong here ${v} out of 5`,
  loneliness: (v) => `Members rated how often they have felt lonely ${v} out of 5`,
  network_size: (v) => `Members could name ${v} people here on average that they would ask for a small favour`,
  participation: (v) => `Members rated how often they take part ${v} out of 5`,
  civic_engagement: (v) => `Members rated their involvement beyond the co-op ${v} out of 5`,
};
