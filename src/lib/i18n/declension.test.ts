import { describe, expect, it } from "vitest";
import { decline } from "./declension";

describe("decline (first names)", () => {
  it.each([
    ["Айдос", "Айдосом", "Айдосу", "Айдоса"],
    ["Ерасыл", "Ерасылом", "Ерасылу", "Ерасыла"],
    ["Нурик", "Нуриком", "Нурику", "Нурика"],
    ["Нурлыбай", "Нурлыбаем", "Нурлыбаю", "Нурлыбая"],
    ["Андрей", "Андреем", "Андрею", "Андрея"],
    ["Игорь", "Игорем", "Игорю", "Игоря"],
    ["Даня", "Даней", "Дане", "Дани"],
    ["Алина", "Алиной", "Алине", "Алины"],
    ["Ольга", "Ольгой", "Ольге", "Ольги"],
    ["Мария", "Марией", "Марии", "Марии"],
    ["Жанна", "Жанной", "Жанне", "Жанны"],
  ] as const)("%s", (name, instr, dat, gen) => {
    expect(decline(name, "instr")).toBe(instr);
    expect(decline(name, "dat")).toBe(dat);
    expect(decline(name, "gen")).toBe(gen);
  });

  it("uses -ем after a sibilant or ц", () => {
    expect(decline("Мирош", "instr")).toBe("Мирошем");
    expect(decline("Юнец", "instr")).toBe("Юнецем");
  });

  it("leaves what it cannot decline unchanged", () => {
    expect(decline("Айгерим", "instr")).toBe("Айгерим"); // a woman's name ending in a consonant
    expect(decline("Салтанат", "dat")).toBe("Салтанат");
    expect(decline("Дима-Ли", "gen")).toBe("Дима-Ли");
    expect(decline("Alex", "instr")).toBe("Alex");
    expect(decline("Марко", "dat")).toBe("Марко");
    expect(decline("Али", "gen")).toBe("Али");
    expect(decline("", "gen")).toBe("");
  });

  it("trims and keeps the capital letter", () => {
    expect(decline("  Айдос ", "gen")).toBe("Айдоса");
  });
});
