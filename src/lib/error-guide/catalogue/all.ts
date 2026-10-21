// All catalogue modules. Order matters only for readability: the framework's matcher decides
// precedence by specificity (network.ts holds the generic catch-alls).
import type { Guide } from "../types";
import { aiGuides } from "./ai";
import { authGuides } from "./auth";
import { billingGuides } from "./billing";
import { boqGuides } from "./boq";
import { changeOrderGuides } from "./change-orders";
import { designStudioGuides } from "./design-studio";
import { documentsGuides } from "./documents";
import { drawingsPermitsGuides } from "./drawings-permits";
import { importGuides } from "./import";
import { labourGuides } from "./labour";
import { materialsGuides } from "./materials";
import { miscGuides } from "./misc";
import { momsScheduleGuides } from "./moms-schedule";
import { networkGuides } from "./network";
import { permissionGuides } from "./permissions";
import { progressGuides } from "./progress";
import { projectGuides } from "./project";
import { reportsAnalysisGuides } from "./reports-analysis";

/** Module label -> guides, used by the integrity test and the owner-document generator. */
export const CATALOGUE_MODULES: Record<string, Guide[]> = {
  "Sign in and invitations": authGuides,
  "Projects": projectGuides,
  "Scope of Work (BOQ)": boqGuides,
  "Work Progress": progressGuides,
  "Change Orders": changeOrderGuides,
  "Billing": billingGuides,
  "Materials": materialsGuides,
  "Labour": labourGuides,
  "Documents and photos": documentsGuides,
  "Drawings, permits, RFIs and site records": drawingsPermitsGuides,
  "MoMs and Schedule": momsScheduleGuides,
  "Design Studio": designStudioGuides,
  "Reports and Analysis": reportsAnalysisGuides,
  "Imports": importGuides,
  "AI and Copilot": aiGuides,
  "Roles and permissions": permissionGuides,
  "Other records": miscGuides,
  "Network and general": networkGuides,
};

export const ALL_GUIDES: Guide[] = Object.values(CATALOGUE_MODULES).flat();
