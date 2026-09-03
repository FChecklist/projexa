// R67 F-34 (audit recommendation R-290) -- the breadcrumb an object route shows
// BEFORE its record exists, and the one it shows after.
//
// They have to be the same string. A loading frame whose breadcrumb reads
// "Minutes of Meeting" and a loaded screen whose breadcrumb reads
// "Minutes of Meeting / Meeting" is a frame that visibly rewrites itself the
// moment the fetch lands -- exactly the flicker frame-first loading exists to
// remove. Keeping both halves on one constant is the only way that cannot drift:
// each route's loading.tsx and each object client read the same entry.
//
// `label` is what the user would call the thing they are waiting for, in their
// own words, and it is what the 3 s sentence uses: "Still loading the meeting…
// 4 s". Not the module name -- a user waiting on one record is not waiting on
// "Minutes of Meeting", they are waiting on the meeting.

export type ObjectBreadcrumb = {
  /** The full breadcrumb literal, identical loading and loaded. */
  breadcrumb: string;
  /** The noun the waiting sentence uses. */
  label: string;
  /** The action names drawn disabled in the loading frame's action bar. */
  actions: string[];
};

export const MOM_OBJECT_BREADCRUMB: ObjectBreadcrumb = {
  breadcrumb: "Minutes of Meeting / Meeting",
  label: "the meeting",
  actions: ["Edit"],
};

export const SCOPE_OBJECT_BREADCRUMB: ObjectBreadcrumb = {
  breadcrumb: "Scope / Bill of Quantities",
  label: "the BOQ revision",
  // ScopeObjectClient never offers Edit -- a BOQ revision is not edited in
  // place. Its footer action is Delete (draft-only) and its own workflow
  // toolbar carries Create Revision, so that is what the loading frame outlines.
  actions: ["Create Revision", "Delete"],
};

export const LABOUR_OBJECT_BREADCRUMB: ObjectBreadcrumb = {
  breadcrumb: "Labour / Worker",
  label: "the worker",
  actions: ["Edit"],
};

export const MATERIAL_OBJECT_BREADCRUMB: ObjectBreadcrumb = {
  breadcrumb: "Materials / Material",
  label: "the material",
  actions: ["Edit"],
};

export const PERMIT_OBJECT_BREADCRUMB: ObjectBreadcrumb = {
  breadcrumb: "Permits / Permit",
  label: "the permit",
  actions: ["Edit"],
};

export const DRAWING_OBJECT_BREADCRUMB: ObjectBreadcrumb = {
  breadcrumb: "Drawings & 3D / Drawing",
  label: "the drawing",
  actions: ["Edit"],
};

export const SCHEDULE_TASK_OBJECT_BREADCRUMB: ObjectBreadcrumb = {
  breadcrumb: "Schedule / Task",
  label: "the task",
  actions: ["Edit"],
};

/** Every object route that ships a frame-first loading.tsx. */
export const OBJECT_BREADCRUMBS = {
  moms: MOM_OBJECT_BREADCRUMB,
  scope: SCOPE_OBJECT_BREADCRUMB,
  labour: LABOUR_OBJECT_BREADCRUMB,
  materials: MATERIAL_OBJECT_BREADCRUMB,
  permits: PERMIT_OBJECT_BREADCRUMB,
  drawings: DRAWING_OBJECT_BREADCRUMB,
  scheduleTask: SCHEDULE_TASK_OBJECT_BREADCRUMB,
} as const;
