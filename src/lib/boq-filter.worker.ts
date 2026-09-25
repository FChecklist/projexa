// PROJEXA-BUILD-001 U-33 (E-10). The Web Worker that owns the project line index. It holds no logic of its own: every message goes to
// answerBoqFilterMessage() in boq-filter-engine.ts, which bun tests directly. Started by boq-filter-client.ts.
import { BoqLineIndex, answerBoqFilterMessage } from "./boq-filter-engine"

// The DOM lib is on for this project, and it types `self` as a Window, whose postMessage wants a target origin. A dedicated worker's
// own scope takes the message alone, so the two members used here are typed by hand.
type WorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage: (message: unknown) => void
}

const scope = self as unknown as WorkerScope
const index = new BoqLineIndex()

scope.onmessage = (event) => {
  scope.postMessage(answerBoqFilterMessage(index, event.data))
}
