import * as assert from "assert";

import {
  FreeCoderModel,
  getFreeCoderModelForRole,
  getFreeCoderModelId,
} from "../../config/modelConfig";

suite("FreeCoder model configuration", () => {
  const models: FreeCoderModel[] = [
    {
      name: "Qwen 3",
      provider: "ollama",
      model: "qwen3-coder:30b",
      roles: ["resolver", "changeGenerator"],
    },
    {
      name: "Qwen Edit",
      provider: "ollama",
      model: "qwen-coder:3b",
      roles: ["planner"],
    },
    {
      name: "Chat Model",
      provider: "ollama",
      model: "chat-model:latest",
      roles: ["chat"],
    },
  ];

  test("creates a stable model ID", () => {
    assert.strictEqual(
      getFreeCoderModelId(models[0]),
      "ollama:qwen3-coder:30b",
    );
  });

  test("selects the first model assigned to a role", () => {
    const model = getFreeCoderModelForRole(models, "planner");

    assert.strictEqual(model.name, "Qwen Edit");
  });

  test("uses the preferred model when it supports the role", () => {
    const model = getFreeCoderModelForRole(
      models,
      "resolver",
      "ollama:qwen3-coder:30b",
    );

    assert.strictEqual(model.name, "Qwen 3");
  });

  test("rejects a preferred model without the requested role", () => {
    assert.throws(
      () =>
        getFreeCoderModelForRole(models, "planner", "ollama:qwen3-coder:30b"),
      /does not support the "planner" role/,
    );
  });

  test("rejects a role that has no configured model", () => {
    assert.throws(
      () => getFreeCoderModelForRole(models, "apply"),
      /No model is configured for the "apply" role/,
    );
  });

  test("rejects an unknown preferred model ID", () => {
    assert.throws(
      () =>
        getFreeCoderModelForRole(models, "resolver", "ollama:missing-model"),
      /was not found/,
    );
  });
});
