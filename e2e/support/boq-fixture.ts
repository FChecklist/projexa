// PROJEXA-BUILD-001 U-33. Synthetic data for the local browser-first BOQ specs: one project of 10,907 line items (the size of the largest
// live project on 2026-09-25) spread over four BOQs, of which the screen is opened for one. Every name, id and figure is made up; nothing
// here comes from a real client or a real BOQ.

export type FixtureLine = {
  id: string
  boqId: string
  boqTitle: string
  boqVersion: number
  boqStatus: string
  parentLineItemId: string | null
  activityId: string | null
  itemCode: string
  category: string
  description: string
  unit: string
  quantity: string
  rate: string
  amount: string
  createdAt: string
}

export const PROJECT_ID = "fixture-project"
export const BOQ_ID = "fixture-boq-current"
export const BOQ_TITLE = "Fixture Tower - Structure"
export const TOTAL_LINES = 10_907
export const OWN_LINES = 40

const WORDS = ["Formwork", "Reinforcement", "Concrete pour", "Excavation", "Plastering", "Tiling", "Painting"] as const

const OTHER_BOQS = [
  { id: "fixture-boq-original", title: BOQ_TITLE, version: 1, status: "superseded" },
  { id: "fixture-boq-mep", title: "Fixture Tower - MEP", version: 1, status: "approved" },
  { id: "fixture-boq-fitout", title: "Fixture Tower - Fit-out", version: 1, status: "draft" },
] as const

export function buildProjectFixture() {
  const lines: FixtureLine[] = []
  let own = 0
  for (let i = 0; i < TOTAL_LINES; i++) {
    const id = `line-${String(i + 1).padStart(6, "0")}`
    const isOwn = i % 272 === 0 && own < OWN_LINES
    if (isOwn) own += 1
    const other = OTHER_BOQS[i % OTHER_BOQS.length]
    const word = WORDS[i % WORDS.length]
    lines.push({
      id,
      boqId: isOwn ? BOQ_ID : other.id,
      boqTitle: isOwn ? BOQ_TITLE : other.title,
      boqVersion: isOwn ? 2 : other.version,
      boqStatus: isOwn ? "approved" : other.status,
      parentLineItemId: null,
      activityId: null,
      itemCode: `FX-${i + 1}`,
      category: word === "Formwork" || word === "Reinforcement" || word === "Concrete pour" ? "Structure" : "Finishes",
      description: isOwn ? `Own slab item ${own}` : `${word} bay ${i + 1}`,
      unit: "m2",
      quantity: "10",
      rate: "12.50",
      amount: "125.00",
      createdAt: "2026-09-01T00:00:00Z",
    })
  }
  return {
    projectId: PROJECT_ID,
    boqId: BOQ_ID,
    boqTitle: BOQ_TITLE,
    lines,
    /** The BOQ header as the /api/scope proxy would return it. */
    header: {
      id: BOQ_ID, projectId: PROJECT_ID, version: 2, title: BOQ_TITLE, status: "approved", parentBoqId: "fixture-boq-original",
      createdAt: "2026-08-28T00:00:00.000Z",
    },
    expected: {
      total: lines.length,
      own: lines.filter((l) => l.boqId === BOQ_ID).length,
      // Lines of the whole project whose description holds "formwork", counted here so the spec compares against a number it did not
      // read back from the screen.
      formworkInProject: lines.filter((l) => l.description.toLowerCase().includes("formwork")).length,
    },
  }
}

export type ProjectFixture = ReturnType<typeof buildProjectFixture>
