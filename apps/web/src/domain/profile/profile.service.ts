import { generateId, nowTs } from "@exam/utils";
import { CreateProfileInputSchema, type CreateProfileInput } from "@exam/schemas";
import type { Profile } from "@exam/shared-types";
import { profileRepository } from "./profile.repository";

/**
 * Business logic for local profiles. No React, no Dexie imports besides the
 * repository — this module is unit-testable in isolation.
 */
export const profileService = {
  async listProfiles(): Promise<Profile[]> {
    return profileRepository.list();
  },

  async hasAnyProfile(): Promise<boolean> {
    return (await profileRepository.count()) > 0;
  },

  async createProfile(input: CreateProfileInput): Promise<Profile> {
    const parsed = CreateProfileInputSchema.parse(input);
    const now = nowTs();
    const profile: Profile = {
      id: generateId("profile"),
      name: parsed.name.trim(),
      avatar: parsed.avatar,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    };
    await profileRepository.create(profile);
    return profile;
  },

  async renameProfile(id: string, name: string): Promise<void> {
    const parsed = CreateProfileInputSchema.pick({ name: true }).parse({ name });
    await profileRepository.update(id, { name: parsed.name.trim(), updatedAt: nowTs() });
  },

  async changeAvatar(id: string, avatar: string): Promise<void> {
    await profileRepository.update(id, { avatar, updatedAt: nowTs() });
  },

  async touchLastActive(id: string): Promise<void> {
    await profileRepository.update(id, { lastActiveAt: nowTs() });
  },

  async deleteProfile(id: string): Promise<void> {
    await profileRepository.remove(id);
  },

  async switchProfile(id: string): Promise<Profile | undefined> {
    const profile = await profileRepository.get(id);
    if (!profile) return undefined;
    await this.touchLastActive(id);
    return profile;
  }
};
