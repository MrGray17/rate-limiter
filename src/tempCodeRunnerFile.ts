test("A GET /health should return 200", async () => {
  const setup = await BoringServerManagement("/health");
  await startServer(setup.serverP);

  try {
    const response = await fetch(setup.url, { method: "GET" });
    assert.strictEqual(response.status, 200);
  } finally {
    await closeServer(setup.serverP);
  }
});
