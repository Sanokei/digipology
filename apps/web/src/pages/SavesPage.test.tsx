import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { relativeSavedTime, SavesPageContent } from "./SavesPage";
import { TableMenuContent } from "../components/TableMenu";

test("saved-table relative labels are stable", () => {
  expect(relativeSavedTime("2026-08-16T11:00:00.000Z", Date.parse("2026-08-16T12:00:00.000Z"))).toBe("1h ago");
});

test("table menu exposes host actions additively", () => {
  const host = renderToStaticMarkup(<MemoryRouter><TableMenuContent isHost signedIn saveHidden={false} scripted={false} busy={false} onDiagnostics={() => {}} onSave={() => {}} onEnd={() => {}} /></MemoryRouter>);
  expect(host).toContain("Save table"); expect(host).toContain("End table"); expect(host).toContain("Diagnostics");
  const guestHost = renderToStaticMarkup(<MemoryRouter><TableMenuContent isHost signedIn={false} saveHidden={false} scripted={false} busy={false} onDiagnostics={() => {}} onSave={() => {}} onEnd={() => {}} /></MemoryRouter>);
  expect(guestHost).toContain("Sign in to save this table");
  const nonHost = renderToStaticMarkup(<MemoryRouter><TableMenuContent isHost={false} signedIn saveHidden={false} scripted={false} busy={false} onDiagnostics={() => {}} onSave={() => {}} onEnd={() => {}} /></MemoryRouter>);
  expect(nonHost).not.toContain("Save table"); expect(nonHost).not.toContain("End table");
});

test("table menu warns scripted hosts before saving", () => {
  const scripted = renderToStaticMarkup(<MemoryRouter><TableMenuContent isHost signedIn saveHidden={false} scripted busy={false} onDiagnostics={() => {}} onSave={() => {}} onEnd={() => {}} /></MemoryRouter>);
  expect(scripted).toContain("Scripted games can&#x27;t be resumed yet — you can save now and resume once support lands.");
  const unscripted = renderToStaticMarkup(<MemoryRouter><TableMenuContent isHost signedIn saveHidden={false} scripted={false} busy={false} onDiagnostics={() => {}} onSave={() => {}} onEnd={() => {}} /></MemoryRouter>);
  expect(unscripted).not.toContain("Scripted games can&#x27;t be resumed yet");
});

test("saved tables page renders a populated account list", () => {
  const html = renderToStaticMarkup(<SavesPageContent
    user={{ id: "user_1", name: "Ada", email: "ada@example.com" }}
    loading={false}
    saves={[{
      saveId: "save_1",
      gameSlug: "zone-runner",
      gameTitle: "Zone Runner",
      releaseId: "builtin_zone_runner_2",
      sequence: 42,
      createdAt: new Date().toISOString(),
      byteLength: 2048,
      label: "Friday crew",
    }]}
    pending={null}
    error={null}
    onSignIn={() => {}}
    onRetry={() => {}}
    onResume={() => {}}
    onDelete={() => {}}
  />);
  expect(html).toContain("Friday crew");
  expect(html).toContain("Zone Runner");
  expect(html).toContain("sequence 42");
  expect(html).toContain("builtin_zone_runne");
  expect(html).toContain(">Resume<");
  expect(html).toContain(">Delete<");
});

test("saved tables page renders the empty state", () => {
  const html = renderToStaticMarkup(<SavesPageContent
    user={{ id: "user_1", name: "Ada", email: "ada@example.com" }}
    loading={false}
    saves={[]}
    pending={null}
    error={null}
    onSignIn={() => {}}
    onRetry={() => {}}
    onResume={() => {}}
    onDelete={() => {}}
  />);
  expect(html).toContain("No saved tables yet");
  expect(html).toContain("Hosts can save a live table from its table menu.");
});

test("saved tables page disables scripted resume and explains why", () => {
  const savedTable = {
    saveId: "save_1", gameSlug: "zone-runner", gameTitle: "Zone Runner",
    releaseId: "builtin_zone_runner_2", sequence: 42,
    createdAt: new Date().toISOString(), byteLength: 2048,
  };
  const blocked = renderToStaticMarkup(<SavesPageContent
    user={{ id: "user_1", name: "Ada", email: "ada@example.com" }}
    loading={false}
    saves={[{ ...savedTable, resumable: false, resumeBlockedReason: "scripted_resume_unsupported" }]}
    pending={null}
    error={null}
    onSignIn={() => {}}
    onRetry={() => {}}
    onResume={() => {}}
    onDelete={() => {}}
  />);
  expect(blocked).toContain('<button type="button" disabled="">Resume</button>');
  expect(blocked).toContain("Scripted games can&#x27;t be resumed yet. This save is kept until resume support lands.");
  const resumable = renderToStaticMarkup(<SavesPageContent
    user={{ id: "user_1", name: "Ada", email: "ada@example.com" }}
    loading={false}
    saves={[{ ...savedTable, resumable: true }]}
    pending={null}
    error={null}
    onSignIn={() => {}}
    onRetry={() => {}}
    onResume={() => {}}
    onDelete={() => {}}
  />);
  expect(resumable).toContain('<button type="button">Resume</button>');
  expect(resumable).not.toContain("Scripted games can&#x27;t be resumed yet");
});

test("saved tables page renders a signed-out sign-in prompt", () => {
  const html = renderToStaticMarkup(<SavesPageContent
    user={null}
    loading={false}
    saves={[]}
    pending={null}
    error={null}
    onSignIn={() => {}}
    onRetry={() => {}}
    onResume={() => {}}
    onDelete={() => {}}
  />);
  expect(html).toContain("Sign in to see saved tables");
  expect(html).toContain("Saved tables belong to your account.");
  expect(html).toContain(">Sign in<");
});
