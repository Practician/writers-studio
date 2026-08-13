export default class WritersStudioFixtureProvider {
  id = () => "writers-studio-fixture";

  async callApi(_prompt, context) {
    const output = typeof context?.vars?.mockOutput === "string"
      ? context.vars.mockOutput
      : "";
    return {
      output,
      metadata: {
        fixture: context?.vars?.id || "unknown",
        localOnly: true,
      },
    };
  }
}
