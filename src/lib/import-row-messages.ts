// R67 lane D22 (item D-68, rec R-258): attributing an importer's messages to
// the rows they are about.
//
// VERIDIAN's BOQ and programme importers both report their findings as flat
// string lists, and every message that concerns a specific row already begins
// with the row number the person can find in Excel ("Row 14: Finish before
// Start", "Row 3: Rate is blank"). That prefix is the attribution -- this reads
// it, so the shared ImportScreen can put each message on its own row instead of
// dumping a list above the grid and leaving the reader to count.
//
// Deliberately a PRESENTER, not a parser: the messages themselves are still
// authored server-side, in one place, and this never invents or rewords one.
// A message with no row prefix stays sheet-level, which is exactly right for
// things like "Reading dates as dd/mm/yyyy".

const ROW_PREFIX = /^Row (\d+):\s*/;

export type AttributedMessages = {
  /** row number -> the messages about that row, in the order they were reported. */
  byRow: Map<number, string[]>;
  /** Messages that name no row. */
  sheetLevel: string[];
};

export function attributeRowMessages(messages: string[]): AttributedMessages {
  const byRow = new Map<number, string[]>();
  const sheetLevel: string[] = [];
  for (const message of messages) {
    const match = ROW_PREFIX.exec(message);
    if (!match) {
      sheetLevel.push(message);
      continue;
    }
    const rowNumber = Number.parseInt(match[1]!, 10);
    const existing = byRow.get(rowNumber);
    if (existing) existing.push(message);
    else byRow.set(rowNumber, [message]);
  }
  return { byRow, sheetLevel };
}

/** Pure: the row numbers an importer reported a message about, in ascending order. */
export function reportedRowNumbers(messages: string[]): number[] {
  return [...attributeRowMessages(messages).byRow.keys()].sort((a, b) => a - b);
}
