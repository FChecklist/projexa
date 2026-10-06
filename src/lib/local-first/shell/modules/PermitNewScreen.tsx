"use client";

// LOCAL-FIRST shell, Permit: add with its file (G-15). The form is FileRecordNewScreen's; the data is the permits list's (project and copy state).

import type { ShellScreenProps } from "../types";
import FileRecordNewScreen from "./FileRecordNewScreen";
import type { PermitsListData } from "./permits-adapter";

export default function PermitNewScreen({ shell, data }: ShellScreenProps<PermitsListData>) {
  return <FileRecordNewScreen kind="permit" shell={shell} data={data} />;
}
