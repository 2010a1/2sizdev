import { describe, it, expect, beforeEach, vi } from "vitest";

// Node test env has no localStorage; the store only touches it inside
// init/refresh/select, so stubbing here (before those run) is enough.
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k)
});

import { db } from "../db/database";
import { profileService } from "../domain/profile/profile.service";
import { useProfileStore } from "../state/profileStore";

beforeEach(async () => {
  await db.profiles.clear();
  storage.clear();
  useProfileStore.setState({ activeProfile: null, profiles: [], loading: true });
});

describe("profileStore: refresh reflects profile mutations", () => {
  it("picks up avatar change without reload", async () => {
    const profile = await profileService.createProfile({ name: "Minh" });
    await useProfileStore.getState().init();
    expect(useProfileStore.getState().activeProfile?.avatar).toBeFalsy();

    await profileService.changeAvatar(profile.id, "data:image/png;base64,QQ==");
    await useProfileStore.getState().refresh();

    expect(useProfileStore.getState().activeProfile?.avatar).toBe("data:image/png;base64,QQ==");
  });

  it("picks up rename without reload", async () => {
    const profile = await profileService.createProfile({ name: "Minh" });
    await useProfileStore.getState().init();

    await profileService.renameProfile(profile.id, "Minh Nguyễn");
    await useProfileStore.getState().refresh();

    expect(useProfileStore.getState().activeProfile?.name).toBe("Minh Nguyễn");
  });

  it("keeps fallback when active profile deleted (existing behavior)", async () => {
    const a = await profileService.createProfile({ name: "A" });
    const b = await profileService.createProfile({ name: "B" });
    await useProfileStore.getState().init();
    await useProfileStore.getState().selectProfile(a.id);

    await profileService.deleteProfile(a.id);
    await useProfileStore.getState().refresh();

    expect(useProfileStore.getState().activeProfile?.id).toBe(b.id);
  });
});
