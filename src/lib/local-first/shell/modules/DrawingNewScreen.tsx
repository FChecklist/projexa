"use client";

// LOCAL-FIRST shell, Drawing: add with its file (G-15). The form is FileRecordNewScreen's; the data is the drawings list's (project and copy state).

import type { ShellScreenProps } from "../types";
import FileRecordNewScreen from "./FileRecordNewScreen";
import type { DrawingsListData } from "./drawings-adapter";

export default function DrawingNewScreen({ shell, data }: ShellScreenProps<DrawingsListData>) {
  return <FileRecordNewScreen kind="drawing" shell={shell} data={data} />;
}
