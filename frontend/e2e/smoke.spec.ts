import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, "..", "public", "sample-exchange.csv");

test("register → upload CSV → build graph → node modal → persists on reload", async ({ page }) => {
  await page.goto("/");

  // register a fresh account
  await page.getByText("Нет аккаунта? Зарегистрироваться").click();
  const email = `e2e_${Date.now()}@example.com`;
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill("secret123");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  // workspace visible
  await expect(page.getByText("+ Добавить CSV / XLSX (можно несколько)")).toBeVisible();

  // upload the sample CSV and build
  await page.locator('input[type="file"]').setInputFiles(SAMPLE);
  await page.getByRole("button", { name: "Построить граф" }).click();

  // stats rendered → graph built
  const walletStat = page.locator(".stat", { hasText: "Wallet" }).locator(".num");
  await expect(walletStat).toBeVisible();
  const walletCount = Number(await walletStat.textContent());
  expect(walletCount).toBeGreaterThan(0);

  // linked accounts present (sample has shared IP + wallet)
  await expect(page.getByText(/Связанные аккаунты/)).toBeVisible();

  // open a node via the linked list → modal appears
  await page.locator(".linkrow").first().click();
  await expect(page.locator(".modal")).toBeVisible();

  // mark the node (new feature)
  await page.locator(".markbox select").selectOption("suspect");
  await page.getByRole("button", { name: "Применить метку" }).click();
  await expect(page.getByRole("button", { name: /Сохранено/ })).toBeVisible();
  await page.locator(".modal .x").click();
  await expect(page.locator(".modal")).toHaveCount(0);

  // unsaved-changes guard when starting a new case (new feature)
  await page.getByRole("button", { name: "Новое" }).click();
  await expect(page.getByText("Несохранённые изменения")).toBeVisible();
  await page.getByText("Отмена").click();
  await expect(page.getByText("Несохранённые изменения")).toHaveCount(0);

  // refresh → working graph must survive (the bug we fixed)
  await page.reload();
  const walletStat2 = page.locator(".stat", { hasText: "Wallet" }).locator(".num");
  await expect(walletStat2).toBeVisible({ timeout: 10_000 });
  expect(Number(await walletStat2.textContent())).toBe(walletCount);
});
