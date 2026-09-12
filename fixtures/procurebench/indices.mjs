/**
 * ProcureBench uses the same synthetic series the application ships.
 * The definitions live in src/data/sample-indices.mjs because the page imports
 * them at runtime, and fixtures/ is excluded from deployment.
 */
export { STEEL_A, ENERGY_B } from "../../src/data/sample-indices.mjs";
