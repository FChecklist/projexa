/// <reference types="bun-types" />
// R67 D-67 -- the create archetype, rendered.
//
// create-screen.test.ts proves the RULES. This proves the SCREEN obeys them:
// that the primary is disabled and names what is missing on an empty form
// (/scope/new's teal Save was enabled on one), that a server refusal is
// rendered in place with every value still on the form (Permits used a toast
// and a redirect), and that a chosen file's name survives that refusal (a
// file input cannot be repopulated, so the only way a user knows their PDF is
// still held is if the screen says so).
//
// CreateScreen is a CONTROLLED component -- values and files come from the
// caller -- so every case below is driven by passing the state directly,
// which is both the real contract and deterministic. (Typing with
// fireEvent.change does not propagate to a React-controlled input under
// happy-dom in this repo's test environment; verified with a minimal probe
// before writing these.)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/permits/new",
}));

const { CreateScreen } = await import("./CreateScreen");
const { ProjectScopeProvider } = await import("../shell/project-context");
const { submitFailure } = await import("../../lib/use-submit");

afterEach(cleanup);

const CEDAR = { id: "p-cedar", name: "Cedar Heights Villa - Phase 1" };

const FIELDS = [
  { name: "name", label: "Permit name", kind: "text" as const, required: true, placeholder: "e.g. BP-2026-0142" },
  { name: "permitAuthority", label: "Issuing authority", kind: "text" as const },
  { name: "file", label: "Permit PDF", kind: "file" as const, required: true, accept: "application/pdf" },
];

function renderScreen(
  props: {
    values?: Record<string, string>;
    files?: Record<string, File | null>;
    failure?: ReturnType<typeof submitFailure> | null;
    onRetry?: () => void;
    saving?: boolean;
    saved?: boolean;
  } = {}
) {
  return render(
    <ProjectScopeProvider
      value={{
        projects: [CEDAR],
        project: CEDAR,
        projectId: CEDAR.id,
        projectsLoaded: true,
        selectProject: () => {},
        openSwitcher: () => {},
      }}
    >
      <CreateScreen
        module="Permits"
        moduleHref="/permits"
        objectLabel="Permit"
        fields={FIELDS}
        values={props.values ?? {}}
        onChange={() => {}}
        files={props.files ?? {}}
        onFileChange={() => {}}
        failure={props.failure}
        onRetry={props.onRetry}
        saving={props.saving}
        saved={props.saved}
        onSubmit={() => {}}
      />
    </ProjectScopeProvider>
  );
}

describe("CreateScreen", () => {
  test("an empty form's primary is disabled and names every missing field", () => {
    const { getByRole } = renderScreen();
    const save = getByRole("button", { name: "Save (Permit name, Permit PDF)" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  test("a filled required field drops out of the label", () => {
    const { getByRole } = renderScreen({ values: { name: "BP-2026-0142" } });
    expect((getByRole("button", { name: "Save (Permit PDF)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a complete form's primary says just 'Save' and is live", () => {
    const file = new File(["x"], "permit.pdf", { type: "application/pdf" });
    const { getByRole } = renderScreen({ values: { name: "BP-2026-0142" }, files: { file } });
    const save = getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  test("optional fields are marked optional and never named in the label", () => {
    const { container, getByRole } = renderScreen();
    expect(container.textContent).toContain("(optional)");
    expect(getByRole("button", { name: /^Save \(/ }).textContent).not.toContain("Issuing authority");
  });

  test("no asterisk is used to mean required -- the label is the whole convention", () => {
    const { container } = renderScreen();
    expect(container.textContent).not.toContain("*");
  });

  test("the disabled primary carries the reason, not just the label", () => {
    const { getByRole } = renderScreen();
    expect(getByRole("button", { name: /^Save \(/ }).getAttribute("title")).toBe(
      "Still needed: Permit name, Permit PDF"
    );
  });

  test("a server refusal renders in place, says nothing was saved, and keeps the values", () => {
    const { container, getByLabelText } = renderScreen({
      values: { name: "BP-2026-0142" },
      failure: submitFailure("refused", "Permit", "A permit with that number already exists on this project"),
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Could not save the permit");
    expect(text).toContain("A permit with that number already exists on this project.");
    expect(text).toContain("Nothing was saved");
    expect((getByLabelText(/Permit name/) as HTMLInputElement).value).toBe("BP-2026-0142");
  });

  test("a timeout is NOT framed as a refusal -- it is its own sentence, said once", () => {
    // R67 D-72: the old prop was a bare reason this component wrapped in
    // "Could not save the permit — … Nothing was saved.", which turned a
    // ten-second timeout into a sentence that said "nothing was saved" twice.
    const { container } = renderScreen({ failure: submitFailure("timeout", "Permit") });
    const text = container.textContent ?? "";
    expect(text).toContain("The server did not answer in 10 s — nothing was saved.");
    expect(text).not.toContain("Could not save the permit");
    expect(text.match(/nothing was saved/gi)?.length).toBe(1);
  });

  test("a retryable failure offers Try again, and it re-issues the same save", () => {
    let retries = 0;
    const { getByRole } = renderScreen({
      failure: submitFailure("unreachable", "Permit"),
      onRetry: () => {
        retries += 1;
      },
    });
    (getByRole("button", { name: "Try again" }) as HTMLButtonElement).click();
    expect(retries).toBe(1);
  });

  test("a chosen file's name is echoed, because the input itself cannot hold it across a failure", () => {
    const file = new File(["x"], "permit-BP-2026-0142.pdf", { type: "application/pdf" });
    const { container } = renderScreen({
      files: { file },
      failure: submitFailure("refused", "Permit", "upstream refused"),
    });
    expect(container.textContent).toContain("permit-BP-2026-0142.pdf");
  });

  test("while saving the primary reads 'Saving…' and cannot be pressed twice", () => {
    const { getByRole } = renderScreen({ saving: true });
    expect((getByRole("button", { name: /Saving/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("after a 2xx the primary reads 'Saved' and stays disabled while navigation runs", () => {
    const file = new File(["x"], "permit.pdf", { type: "application/pdf" });
    const { getByRole } = renderScreen({ values: { name: "BP-1" }, files: { file }, saved: true });
    expect((getByRole("button", { name: "Saved" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the breadcrumb names the project, the module and the object", () => {
    const { container } = renderScreen();
    const text = container.textContent ?? "";
    expect(text).toContain("Cedar Heights Villa - Phase 1");
    expect(text).toContain("Permits");
    expect(text).toContain("New Permit");
    expect(text).toContain("Back");
  });
});
