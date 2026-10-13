import { expect, test, type Page } from "@playwright/test";

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.beforeEach(async ({ request }) => {
  const r = await request.post("/api/factory/reset");
  expect(r.ok()).toBeTruthy();
});

test("every page renders without console errors", async ({ page }) => {
  const errors = collectErrors(page);
  for (const path of ["/", "/onboarding", "/dashboard", "/twin", "/assets", "/quality", "/agents", "/simulator", "/approvals", "/sustainability", "/audit", "/integrations"]) {
    // Wait for rendered content rather than "networkidle": the app polls live telemetry every 4 s.
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1, h2").first()).toBeVisible();
    await page.waitForTimeout(500);
  }
  expect(errors).toEqual([]);
});

test("guided factory crisis demo: incident → agents → scenarios → twin → approval → audit", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Launch Factory Demo" }).first().click();
  await expect(page.getByRole("heading", { name: "Factory Command Center" })).toBeVisible();

  // Scripted crisis
  await page.getByRole("button", { name: "Demo controls" }).click();
  await page.getByRole("button", { name: /Run Factory Crisis Demo/ }).click();
  await expect(page.getByText("Guided crisis demo")).toBeVisible();
  await expect(page.getByText(/Assembly Robot A3/).first()).toBeVisible();
  await expect(page.getByText("Critical", { exact: true }).first()).toBeVisible();

  // Agents investigate (real streamed stages)
  await page.getByRole("button", { name: "Investigate with AI agents" }).click();
  await expect(page.getByRole("heading", { name: "AI Operations Command Center" })).toBeVisible();
  await expect(page.getByText("Recommended action")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Without intervention: A-ROB-03 trips at h\+/).first()).toBeVisible();
  await expect(page.getByText(/Reroute ECU-200 to Assembly Line B/).first()).toBeVisible();

  // Scenario comparison responds to parameters
  await page.getByRole("button", { name: "Compare operating plans" }).click();
  await expect(page.getByRole("heading", { name: "What-If Twin Simulator" })).toBeVisible();
  const rerouteCard = page.locator("button", { hasText: "Recommended" }).first();
  await expect(rerouteCard).toContainText("Reroute");
  const before = await page.getByText(/\d+(\.\d)? \/ 100 score|^\d+\.\d$/).allTextContents();
  const slider = page.getByRole("slider", { name: "MCU-7 usable stock" });
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("70% · ")).toBeVisible();
  await expect.poll(async () => JSON.stringify(await page.locator("button:has-text('/ 100 score')").allTextContents())).not.toBe(JSON.stringify(before));
  // restore
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");

  // Digital twin highlight
  await page.getByRole("button", { name: "See it in the digital twin" }).click();
  await expect(page.getByText(/Showing scenario/)).toBeVisible();
  await expect(page.locator(".react-flow__node[data-id='A-ROB-03']")).toBeVisible();

  // Human approval + simulated execution
  await page.getByRole("button", { name: "Review the recommendation" }).click();
  await expect(page.getByRole("heading", { name: "Human Approval & Execution" })).toBeVisible();
  await page.getByRole("button", { name: "Approve & execute" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve & execute" }).click();
  await expect(page.getByText("Execution status (simulated)")).toBeVisible();
  await page.getByRole("button", { name: "Fast-forward 8 h" }).click();
  await expect(page.getByText("All actions completed in the twin")).toBeVisible();
  await expect(page.getByText(/A-ROB-03\s*is\s*healthy/)).toBeVisible();

  // Audit trail records the decision and outcome
  await page.getByRole("button", { name: "View the audit trail" }).click();
  await expect(page.getByRole("heading", { name: "Audit Trail & Event Timeline" })).toBeVisible();
  await expect(page.getByText(/^Approved REC-/).first()).toBeVisible();
  await expect(page.getByText("A-ROB-03 returned to service").first()).toBeVisible();

  expect(errors).toEqual([]);
});

test("reset demo restores the reproducible initial scenario", async ({ request }) => {
  await request.post("/api/demo/crisis");
  await request.post("/api/sim/advance", { data: { hours: 4 } });
  const reset = await (await request.post("/api/factory/reset")).json();
  expect(reset.clock.hour).toBe(0);
  expect(reset.analyses).toHaveLength(0);
  expect(reset.recommendations).toHaveLength(0);
  const rob = reset.assets.find((a: { id: string }) => a.id === "A-ROB-03");
  expect(rob.status).toBe("warning");
  expect(reset.incidents).toHaveLength(1);
});

test("API validates input and returns useful errors", async ({ request }) => {
  const bad = await request.post("/api/faults", { data: { assetId: "A-ROB-03", mode: "explode" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).issues.length).toBeGreaterThan(0);
  const missing = await request.patch("/api/assets/NOPE", { data: { name: "x y" } });
  expect(missing.status()).toBe(404);
  const health = await request.get("/api/health");
  expect((await health.json()).status).toBe("ok");
});

test("isometric twin view supports selection, and the theme toggle persists", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/twin");
  await page.getByRole("button", { name: "Isometric" }).click();
  // first(): the main viewport; camera thumbnails in the asset panel render the scene too
  const robot = page.locator("[data-asset='A-ROB-03']").first();
  await expect(robot).toBeVisible();
  await robot.click();
  await expect(page.getByText("Condition diagnostics")).toBeVisible();
  await page.getByRole("button", { name: "Rotate right" }).click();
  await expect(robot).toBeVisible();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("landing scroll story advances through every chapter", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your factory\./ })).toBeVisible();
  const chapters = ["Every asset. Mirrored.", "It notices what people miss.", "Six agents. One investigation.", "See tomorrow. Choose today.", "You stay in command.", "Every decision, on the record."];
  const total = await page.evaluate(() => (document.querySelector("section[aria-label='TwinForge AI product story']") as HTMLElement).offsetHeight - innerHeight);
  for (let i = 0; i < chapters.length; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(((i + 1.45) / 7) * total));
    await expect(page.getByRole("heading", { name: chapters[i] })).toBeVisible();
  }
  await page.getByText("The crisis, by the numbers").scrollIntoViewIfNeeded();
  await expect(page.getByText("of unplanned downtime avoided")).toBeVisible();
  expect(errors).toEqual([]);
});

test("cameras: twin card → live view (audited) → visual quality review with human disposition", async ({ page, request }) => {
  const errors = collectErrors(page);
  await request.post("/api/demo/crisis");

  // Camera in the isometric twin opens a card with the camera's view
  await page.goto("/twin");
  await page.getByRole("button", { name: "Isometric" }).click();
  await page.getByRole("button", { name: "Camera THM-A1" }).click();
  const card = page.getByTestId("camera-panel");
  await expect(card).toBeVisible();
  await expect(card.getByText(/Hottest: A-ROB-03/)).toBeVisible();
  await expect(card.getByText("Simulated feed", { exact: true })).toBeVisible();

  // The user chooses to watch the live stream; the access is written to the audit trail
  await card.getByRole("button", { name: "Watch live stream" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("live-feed")).toBeVisible();
  await expect(dialog.getByText("Access logged")).toBeVisible();
  await expect
    .poll(async () => ((await (await request.get("/api/audit")).json()) as { entries: { title: string }[] }).entries.some((e) => e.title === "Live view opened: THM-A1"))
    .toBe(true);
  await dialog.getByRole("button", { name: "Close" }).click();

  // Visual Quality: rising AOI rejects linked to the robot; review needs a human decision
  await page.getByRole("link", { name: "Visual Quality" }).click();
  await expect(page.getByRole("heading", { name: "Visual Quality" })).toBeVisible();
  await expect(page.getByText("rising", { exact: true })).toBeVisible();
  await expect(page.getByText(/r = 0\.\d\d/).first()).toBeVisible();
  await expect(page.getByTestId("camera-tile")).toHaveCount(9);
  await page.getByRole("button", { name: "Review last 60 units" }).click();
  const review = page.getByTestId("vision-review").first();
  await expect(review.getByText("Awaiting human review")).toBeVisible();
  await review.getByRole("button", { name: /Confirm/ }).click();
  await expect(review.getByText("confirmed")).toBeVisible();
  expect(errors).toEqual([]);
});

test("camera API rejects insecure stream URLs and reports Gemini honestly", async ({ request }) => {
  const insecure = await request.patch("/api/cameras/CCTV-A1", { data: { kind: "hls", url: "http://10.0.0.9/a.m3u8" } });
  expect(insecure.status()).toBe(400);
  const unknown = await request.post("/api/cameras/NOPE/view", { data: {} });
  expect(unknown.status()).toBe(404);
  const integrations = (await (await request.get("/api/integrations")).json()) as { integrations: { id: string; state: string }[] };
  const vertex = integrations.integrations.find((i) => i.id === "vertex-ai")!;
  const upload = await request.post("/api/vision/analyze", { multipart: { file: { name: "frame.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } } });
  if (vertex.state === "not-configured") expect(upload.status()).toBe(503);
  else expect([201, 502]).toContain(upload.status());

  // Python vision service: an honest 503 when it isn't connected; a real verdict on the input when it is
  const vision = integrations.integrations.find((i) => i.id === "vision-service")!;
  const inspect = await request.post("/api/vision/inspect", { multipart: { file: { name: "frame.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } } });
  if (vision.state === "not-configured") expect(inspect.status()).toBe(503);
  else expect([422, 502]).toContain(inspect.status());
});
