import type { Household, Member, Profile, Purchase, Share } from "./types";

export const ME_ID = "00000000-0000-4000-8000-000000000001";
export const HOUSEHOLD_ID = "10000000-0000-4000-8000-000000000001";

export type Seed = {
  me: Profile;
  profiles: Profile[];
  households: Household[];
  members: Member[];
  purchases: Purchase[];
  shares: Share[];
};

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12)).toISOString();

export function createSeed(): Seed {
  const person = (n: number, name: string, color: string, phone: string | null): Profile => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    display_name: name,
    kaspi_phone: phone,
    avatar_color: color,
    created_at: day(1),
  });
  const me = person(1, "Ерасыл", "me", "+77010000001");
  const aidos = person(2, "Айдос", "blue", "+77010000002");
  const danya = person(3, "Даня", "brown", "+77010000003");
  const nurik = person(4, "Нурик", "purple", null);
  const profiles = [me, aidos, danya, nurik];

  const household: Household = {
    id: HOUSEHOLD_ID,
    name: "Квартира 42",
    invite_code: "KV42AB7K9M3X",
    created_by: me.id,
    created_at: day(1),
  };
  const members: Member[] = profiles.map((p, i) => ({
    household_id: household.id,
    user_id: p.id,
    role: i === 0 ? "admin" : "member",
    away_until: null,
    joined_at: day(1),
  }));

  const purchases: Purchase[] = [
    {
      id: "20000000-0000-4000-8000-000000000001",
      household_id: household.id,
      payer_id: me.id,
      amount: 6000,
      description: "Продукты",
      merchant: "Magnum",
      source: "apple_pay",
      status: "shared",
      created_at: day(3),
    },
    {
      id: "20000000-0000-4000-8000-000000000002",
      household_id: household.id,
      payer_id: aidos.id,
      amount: 2000,
      description: "Вода",
      merchant: null,
      source: "manual",
      status: "shared",
      created_at: day(4),
    },
    {
      id: "20000000-0000-4000-8000-000000000003",
      household_id: household.id,
      payer_id: danya.id,
      amount: 900,
      description: "Личное",
      merchant: null,
      source: "manual",
      status: "personal",
      created_at: day(5),
    },
  ];

  const shares: Share[] = [
    ...[aidos, danya, nurik].map((p) => ({
      purchase_id: purchases[0].id,
      debtor_id: p.id,
      amount: 1500,
      settled_at: null,
      settlement_id: null,
    })),
    ...[me, danya, nurik].map((p) => ({
      purchase_id: purchases[1].id,
      debtor_id: p.id,
      amount: 500,
      settled_at: null,
      settlement_id: null,
    })),
  ];

  return { me, profiles, households: [household], members, purchases, shares };
}
