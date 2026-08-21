import { create } from "zustand";
import type { Profile } from "@exam/shared-types";
import { profileService } from "../domain/profile/profile.service";

/**
 * Only the *active profile id* lives in localStorage — a tiny piece of UI
 * state, not primary data (see architecture rule: IndexedDB is the source
 * of truth; localStorage is only for small UI bits).
 */
const ACTIVE_PROFILE_KEY = "thi-thu:active-profile-id";

interface ProfileStoreState {
  activeProfile: Profile | null;
  profiles: Profile[];
  loading: boolean;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  selectProfile: (id: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  clearActiveProfile: () => void;
}

function persistActiveId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  else localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

export const useProfileStore = create<ProfileStoreState>((set, get) => ({
  activeProfile: null,
  profiles: [],
  loading: true,

  async init() {
    set({ loading: true });
    const profiles = await profileService.listProfiles();
    const savedId = localStorage.getItem(ACTIVE_PROFILE_KEY);
    const active =
      (savedId && profiles.find((p) => p.id === savedId)) || profiles[0] || null;
    persistActiveId(active?.id ?? null);
    set({ profiles, activeProfile: active, loading: false });
  },

  /**
   * Re-reads the profile list and reconciles the active profile against it.
   * If the previously-active profile no longer exists (e.g. it was just
   * deleted), falls back to the first remaining profile, or to `null` if
   * none are left — and keeps localStorage in sync with that decision so a
   * reload doesn't resurrect a dangling id. This is the single place that
   * decides "who is active" after any mutation.
   */
  async refresh() {
    const profiles = await profileService.listProfiles();
    const current = get().activeProfile;
    const stillExists = current && profiles.find((p) => p.id === current.id);
    const next = stillExists ? current! : profiles[0] ?? null;
    persistActiveId(next?.id ?? null);
    set({ profiles, activeProfile: next });
  },

  async selectProfile(id: string) {
    const profile = await profileService.switchProfile(id);
    if (!profile) return;
    persistActiveId(id);
    await get().refresh();
    set({ activeProfile: profile });
  },

  /** Deletes a profile and reconciles active-profile state in one step (see refresh()). */
  async deleteProfile(id: string) {
    await profileService.deleteProfile(id);
    await get().refresh();
  },

  clearActiveProfile() {
    persistActiveId(null);
    set({ activeProfile: null });
  }
}));
