"use client";

// LOCAL-FIRST shell, Document: add with its file (G-15). The form is FileRecordNewScreen's; the data is the documents list's (project and copy state).

import type { ShellScreenProps } from "../types";
import FileRecordNewScreen from "./FileRecordNewScreen";
import type { DocumentsListData } from "./documents-adapter";

export default function DocumentNewScreen({ shell, data }: ShellScreenProps<DocumentsListData>) {
  return <FileRecordNewScreen kind="document" shell={shell} data={data} />;
}
