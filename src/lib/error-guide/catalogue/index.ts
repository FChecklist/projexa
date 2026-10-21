import type { Guide } from "../types";
import { baseGuides } from "./base";

// ONE place that lists the catalogue files. To add a file of guides: create catalogue/<name>.ts exporting a `Guide[]`, import it here and spread it
// in. More specific guides (more `match` keys) win over the base ones automatically.
export const catalogue: Guide[] = [...baseGuides];
