// LOCAL-FIRST shell route cluster "ERP A": inventory, purchase orders, procurement, floor plans, mood boards, knowledge base.
// Read-only screens drawn from the organisation kinds of the sync service (modules/erp-a-adapters.ts has the rules). Nav orders 400-449.
//
// Static paths win over ":param" paths (paths.ts matchRoute), but a create page under a parameterised pattern is registered below as the
// delivery cluster's server-only screen anyway, so "new" is never read as an id and the page opens from the server when online.

import { defineShellRoute, type ShellRoute } from "../types";
import {
  loadFloorPlanObject, loadFloorPlans, loadInventory, loadItemObject, loadKbPage, loadKnowledgeBase, loadMoodBoardObject, loadMoodBoards,
  loadProcurement, loadProcurementObject, loadPurchaseOrderObject, loadPurchaseOrders,
} from "../modules/erp-a-adapters";

const serverOnly = (pattern: string, what: string) =>
  defineShellRoute({ pattern, title: what, load: () => import("../modules/DeliveryServerOnlyScreen"), adapter: async () => ({ path: pattern, what }) });

export const ROUTES: readonly ShellRoute[] = [
  defineShellRoute({
    pattern: "/inventory", title: "Inventory", nav: { label: "Inventory", order: 400 },
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.InventoryScreen })),
    adapter: (shell, _params, query) => loadInventory(shell.data, query.get("tab"), query.get("page")),
  }),
  serverOnly("/inventory/items/new", "Adding an item"),
  defineShellRoute({
    pattern: "/inventory/items/:id", title: "Item",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.ItemObjectScreen })),
    adapter: (shell, params) => loadItemObject(shell.data, params.id!),
  }),
  defineShellRoute({
    pattern: "/purchase-orders", title: "Purchase Orders", nav: { label: "Purchase Orders", order: 410 },
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.PurchaseOrdersScreen })),
    adapter: (shell) => loadPurchaseOrders(shell.data),
  }),
  defineShellRoute({
    pattern: "/procurement", title: "Procurement", nav: { label: "Procurement", order: 420 },
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.ProcurementScreen })),
    adapter: (shell, _params, query) => loadProcurement(shell.data, query.get("tab")),
  }),
  defineShellRoute({
    pattern: "/procurement/purchase-orders/:id", title: "Purchase Order",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.PurchaseOrderObjectScreen })),
    adapter: (shell, params) => loadPurchaseOrderObject(shell.data, params.id!),
  }),
  serverOnly("/procurement/requisitions/new", "Raising a requisition"),
  defineShellRoute({
    pattern: "/procurement/requisitions/:id", title: "Requisition",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.ProcurementObjectScreen })),
    adapter: (shell, params) => loadProcurementObject(shell.data, "requisition", params.id!),
  }),
  serverOnly("/procurement/rfqs/new", "Raising an RFQ"),
  defineShellRoute({
    pattern: "/procurement/rfqs/:id", title: "RFQ",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.ProcurementObjectScreen })),
    adapter: (shell, params) => loadProcurementObject(shell.data, "rfq", params.id!),
  }),
  serverOnly("/procurement/goods-receipts/new", "Recording a goods receipt"),
  defineShellRoute({
    pattern: "/procurement/goods-receipts/:id", title: "Goods Receipt",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.ProcurementObjectScreen })),
    adapter: (shell, params) => loadProcurementObject(shell.data, "goods-receipt", params.id!),
  }),
  defineShellRoute({
    pattern: "/floor-plans", title: "Floor Plans", nav: { label: "Floor Plans", order: 430 },
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.FloorPlansScreen })),
    adapter: (shell) => loadFloorPlans(shell.data, shell.projectId),
  }),
  defineShellRoute({
    pattern: "/floor-plans/:id", title: "Floor Plan",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.FloorPlanObjectScreen })),
    adapter: (shell, params) => loadFloorPlanObject(shell.data, params.id!),
  }),
  defineShellRoute({
    pattern: "/mood-boards", title: "Mood Boards", nav: { label: "Mood Boards", order: 435 },
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.MoodBoardsScreen })),
    adapter: (shell) => loadMoodBoards(shell.data, shell.projectId),
  }),
  serverOnly("/mood-boards/new", "Creating a mood board"),
  defineShellRoute({
    pattern: "/mood-boards/:id", title: "Mood Board",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.MoodBoardObjectScreen })),
    adapter: (shell, params) => loadMoodBoardObject(shell.data, params.id!),
  }),
  defineShellRoute({
    pattern: "/knowledge-base", title: "Knowledge Base", nav: { label: "Knowledge Base", order: 440 },
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.KnowledgeBaseScreen })),
    adapter: (shell) => loadKnowledgeBase(shell.data),
  }),
  serverOnly("/knowledge-base/new", "Writing a page"),
  defineShellRoute({
    pattern: "/knowledge-base/:id", title: "Knowledge Base page",
    load: () => import("../modules/ErpAScreens").then((m) => ({ default: m.KbPageScreen })),
    adapter: (shell, params) => loadKbPage(shell.data, params.id!),
  }),
];
