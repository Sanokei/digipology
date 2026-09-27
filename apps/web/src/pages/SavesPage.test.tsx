import * as React from "react";
import * as Router from "react-router-dom";
import * as Auth from "../auth/AuthContext";
import { api } from "../api/client";
import * as RoomSession from "../utils/roomSession";
import { expect, test, spyOn } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { relativeSavedTime, SavesPage, SavesPageContent } from "./SavesPage";
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

test("table menu explains scripted resume before saving", () => {
  const scripted = renderToStaticMarkup(<MemoryRouter><TableMenuContent isHost signedIn saveHidden={false} scripted busy={false} onDiagnostics={() => {}} onSave={() => {}} onEnd={() => {}} /></MemoryRouter>);
  expect(scripted).toContain("Script state, turns, and scores will resume with the new room roster.");
  const unscripted = renderToStaticMarkup(<MemoryRouter><TableMenuContent isHost signedIn saveHidden={false} scripted={false} busy={false} onDiagnostics={() => {}} onSave={() => {}} onEnd={() => {}} /></MemoryRouter>);
  expect(unscripted).not.toContain("Script state, turns, and scores");
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

test("saved tables page disables legacy blocked saves and explains why", () => {
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
  expect(blocked).toContain("This save cannot be resumed by the current server.");
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
  expect(resumable).not.toContain("cannot be resumed by the current server");
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

// Exercise the page's rendered handlers and state transitions without a DOM dependency.
// Effects are started explicitly so the initial render can be checked before fetching.
function pageHarness() {
  const states: unknown[] = [];
  let cursor = 0;
  const navigations: unknown[] = [];
  let effect: (() => void) | undefined;
  const mocks = [
    spyOn(Auth, "useAuth").mockReturnValue({
      user: { id: "user_1", name: "Ada", email: "ada@example.com" }, loading: false,
      refresh: async () => {}, logout: async () => {},
    }),
    spyOn(Router, "useNavigate").mockReturnValue((to) => { navigations.push(to); }),
    spyOn(Router, "useLocation").mockReturnValue({ pathname: "/saves", search: "", hash: "", state: null, key: "test" }),
    spyOn(React, "useState").mockImplementation(((initial: unknown) => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function" ? next(states[index]) : next;
      }];
    }) as typeof React.useState),
    spyOn(React, "useCallback").mockImplementation((callback) => callback),
    spyOn(React, "useEffect").mockImplementation((callback) => { effect = callback; }),
  ];
  return {
    navigations,
    render() {
      cursor = 0;
      const element = SavesPage();
      return element.props.children[1].props as React.ComponentProps<typeof SavesPageContent>;
    },
    start() { effect?.(); },
    restore() { mocks.reverse().forEach((mock) => mock.mockRestore()); },
  };
}

const retryFailure = { ok: false as const, error: { code: "network_error", message: "Try again" } };
const settlePage = () => new Promise((resolve) => setTimeout(resolve, 0));

test("initial saved-table fetch shows loading instead of an empty account", async () => {
  const list = spyOn(api, "listSaves").mockResolvedValue({ ok: true, value: { saves: [] } });
  const page = pageHarness();
  try {
    const initial = renderToStaticMarkup(<SavesPageContent {...page.render()} />);
    expect(initial).toContain("Loading saved tables");
    expect(initial).not.toContain("No saved tables yet");
    page.start();
    await settlePage();
    expect(renderToStaticMarkup(<SavesPageContent {...page.render()} />)).toContain("No saved tables yet");
  } finally { page.restore(); list.mockRestore(); }
});

for (const operation of ["resume", "delete"] as const) {
  test(`Retry repeats failed ${operation} for the same saved table`, async () => {
    const saved = {
      saveId: "save_retry", gameSlug: "first-deal", gameTitle: "First Deal",
      releaseId: "builtin_first_deal_1", sequence: 42, createdAt: "2026-09-27T00:00:00Z", byteLength: 100,
    };
    const resumed = {
      roomId: "new_room", joinCode: "AAAA-2222", inviteUrl: "https://example.com/join/AAAA-2222",
      playerId: "host", roomToken: "new_token", wsUrl: "wss://example.com/room",
      releaseId: saved.releaseId, gameTitle: saved.gameTitle,
    };
    const list = spyOn(api, "listSaves").mockResolvedValue({ ok: true, value: { saves: [saved] } });
    const persist = spyOn(RoomSession, "saveRoomSession").mockImplementation(() => {});
    const mutation = operation === "resume"
      ? spyOn(api, "resumeSave").mockResolvedValueOnce(retryFailure).mockResolvedValue({ ok: true, value: resumed })
      : spyOn(api, "deleteSave").mockResolvedValueOnce(retryFailure).mockResolvedValue({ ok: true, value: undefined });
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let confirmations = 0;
    Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => { confirmations += 1; return true; } } });
    const page = pageHarness();
    try {
      page.render(); page.start(); await settlePage();
      const content = page.render();
      if (operation === "resume") content.onResume("save_retry");
      else content.onDelete("save_retry");
      await settlePage();
      expect(page.render().error).toBe("Try again");
      page.render().onRetry();
      await settlePage();
      expect(mutation.mock.calls).toEqual([["save_retry"], ["save_retry"]]);
      expect(list).toHaveBeenCalledTimes(1);
      expect(page.render().error).toBeNull();
      expect(page.render().pending).toBeNull();
      if (operation === "resume") {
        expect(persist).toHaveBeenCalledWith(resumed);
        expect(page.navigations).toEqual(["/table/new_room"]);
      } else {
        expect(page.render().saves).toEqual([]);
        expect(confirmations).toBe(1);
        expect(persist).not.toHaveBeenCalled();
      }
    } finally {
      page.restore(); mutation.mockRestore(); list.mockRestore(); persist.mockRestore();
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}

test("Retry after a list failure reloads the list", async () => {
  const list = spyOn(api, "listSaves").mockResolvedValueOnce(retryFailure)
    .mockResolvedValue({ ok: true, value: { saves: [] } });
  const page = pageHarness();
  try {
    page.render(); page.start(); await settlePage();
    expect(page.render().error).toBe("Try again");
    page.render().onRetry();
    expect(page.render().loading).toBe(true);
    await settlePage();
    expect(list).toHaveBeenCalledTimes(2);
    expect(page.render().error).toBeNull();
    expect(page.render().loading).toBe(false);
  } finally { page.restore(); list.mockRestore(); }
});
