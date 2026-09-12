/**
 * Synthetic index series for ProcureBench.
 *
 * FICTIONAL. These are not real published indices and the numbers are invented.
 * They are shaped to exercise specific failure modes, not to resemble any
 * particular market.
 */
import { createSeries } from "../calc/index-series.mjs";

/**
 * Shaped so that base-period choice and lag both matter a great deal:
 *
 *   2025-01  100.00   the contractual base
 *   2025-06   92.00   a trough — flattering to measure from
 *   2026-03  104.00   what a 3-month lag actually reaches
 *   2026-06  110.00   the headline the supplier quotes
 *
 * From the contractual base the movement is 10%. From the trough it is 19.57%.
 * With a 3-month lag it is 4%. Same index, same end date, three very different
 * numbers — which is the entire point.
 */
export const STEEL_A = createSeries(
  "synthetic-steel-a",
  "Synthetic Steel Index A",
  [
    ["2024-10", "98.00"],
    ["2025-01", "100.00"],
    ["2025-03", "97.50"],
    ["2025-06", "92.00"],
    ["2025-09", "95.00"],
    ["2025-12", "101.00"],
    ["2026-03", "104.00"],
    ["2026-06", "110.00"],
  ],
  { synthetic: true }
);

/** A calm series, for cases where the index is not the interesting part. */
export const ENERGY_B = createSeries(
  "synthetic-energy-b",
  "Synthetic Energy Index B",
  [
    ["2025-01", "100.00"],
    ["2025-06", "103.00"],
    ["2025-12", "106.00"],
    ["2026-03", "108.00"],
    ["2026-06", "112.00"],
  ],
  { synthetic: true }
);
