import type { AvatarColor } from "@/components/ui/Avatar";
import type { Profile } from "@/lib/data/types";

/** The current user is always lime; housemates use their stored person color. */
export function avatarColorFor(profile: Pick<Profile, "id" | "avatar_color">, meId: string | undefined): AvatarColor {
  if (profile.id === meId) return "me";
  return profile.avatar_color === "brown" || profile.avatar_color === "purple" ? profile.avatar_color : "blue";
}
