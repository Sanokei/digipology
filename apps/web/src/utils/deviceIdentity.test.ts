import { describe, expect, it } from "bun:test";

import { DEVICE_COOKIE_MAX_AGE, DEVICE_ID_KEY, deviceIdentity, resolveDeviceId } from "./deviceIdentity";

function environment(localId: string | null, cookieId: string | null) {
  const values = new Map<string, string>();
  if (localId !== null) values.set(DEVICE_ID_KEY, localId);
  let cookie = cookieId;
  let writtenMaxAge = 0;
  let generated = 0;
  return {
    fake: {
      storage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
      readCookie: () => cookie,
      writeCookie: (id: string, maxAge: number) => { cookie = id; writtenMaxAge = maxAge; },
      randomUUID: () => { generated += 1; return "generated-id"; },
    },
    local: () => values.get(DEVICE_ID_KEY),
    cookie: () => cookie,
    maxAge: () => writtenMaxAge,
    generated: () => generated,
  };
}

describe("guest device identity persistence", () => {
  it("uses the stable account id for signed-in users", () => {
    expect(deviceIdentity({ id: "user-44" })).toBe("user:user-44");
  });

  it("re-seeds the cookie from localStorage", () => {
    const env = environment("local-id", null);
    expect(resolveDeviceId(env.fake)).toBe("local-id");
    expect(env.cookie()).toBe("local-id");
    expect(env.maxAge()).toBe(DEVICE_COOKIE_MAX_AGE);
  });

  it("re-seeds localStorage from the surviving cookie", () => {
    const env = environment(null, "cookie-id");
    expect(resolveDeviceId(env.fake)).toBe("cookie-id");
    expect(env.local()).toBe("cookie-id");
  });

  it("generates once and writes both stores when neither exists", () => {
    const env = environment(null, null);
    expect(resolveDeviceId(env.fake)).toBe("generated-id");
    expect(env.local()).toBe("generated-id");
    expect(env.cookie()).toBe("generated-id");
    expect(env.generated()).toBe(1);
  });
});
