/**
 * Inventory Automation Index
 *
 * Central export point for all inventory automation services and engines.
 */

// Service
export { inventoryAutomationService } from "./inventory-automation.service";

// Types
export * from "./inventory-automation.types";

// Engines
export * from "@/lib/inventory-auto-reorder";
export * from "@/lib/inventory-smart-supplier";
export * from "@/lib/inventory-auto-po";
export * from "@/lib/inventory-stock-optimization";
