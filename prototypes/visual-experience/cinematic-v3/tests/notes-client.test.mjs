import test from "node:test";
import assert from "node:assert/strict";
import { createNotesClient } from "../src/notes-client.ts";
import { sourceLinks } from "../../../block-library/note-view.ts";

test("notes transport uses only the released public family and exact named DTOs", async () => {
  const calls = [],
    applied = [];
  const client = createNotesClient({
    command: async (family, request) => {
      calls.push({ family, request });
      return { result: request.input };
    },
    apply: (snapshot) => applied.push(snapshot),
  });
  const cases = [
    ["readNote", "canonical-note"],
    [
      "saveNoteDraft",
      {
        resourceId: "canonical-note",
        expectedDraftVersion: 2,
        baseResourceVersion: 7,
        content: "Synthetic draft",
      },
    ],
    [
      "commitNote",
      {
        resourceId: "canonical-note",
        expectedResourceVersion: 7,
        expectedDraftVersion: 3,
        content: "Synthetic draft",
      },
    ],
    [
      "discardNoteDraft",
      { resourceId: "canonical-note", expectedDraftVersion: 4 },
    ],
    [
      "renameNote",
      {
        resourceId: "canonical-note",
        expectedResourceVersion: 8,
        title: "Synthetic title",
      },
    ],
  ];
  for (const [name, input] of cases)
    assert.deepEqual(await client[name](input), input);
  assert.deepEqual(
    calls,
    cases.map(([name, input]) => ({
      family: "notes",
      request: { name, input },
    })),
  );
  assert.deepEqual(applied, []);
});

test("only an actual native result applies a desktop snapshot; rejection preserves the caller's conflict", async () => {
  const applied = [],
    snapshot = { revision: 8 };
  const client = createNotesClient({
    command: async (_family, request) => {
      if (request.name === "commitNote")
        throw new Error("note_version_conflict");
      return {
        result: { resource: { id: "canonical-note" } },
        desktop: snapshot,
      };
    },
    apply: (value) => applied.push(value),
  });
  await client.renameNote({
    resourceId: "canonical-note",
    expectedResourceVersion: 7,
    title: "Synthetic renamed",
  });
  await assert.rejects(
    client.commitNote({
      resourceId: "canonical-note",
      expectedResourceVersion: 7,
      expectedDraftVersion: 2,
      content: "Synthetic retained",
    }),
    /note_version_conflict/,
  );
  assert.deepEqual(applied, [snapshot]);
});

test("research source links are bounded user-provided HTTP addresses and exclude credential-bearing URLs", () => {
  assert.deepEqual(
    sourceLinks(
      "[Source](https://example.test/path). https://example.test/path https://user:secret@example.test/private javascript:alert(1) file:///secret",
    ),
    ["https://example.test/path"],
  );
  assert.equal(
    sourceLinks(
      Array.from({ length: 80 }, (_, i) => "https://example.test/" + i).join(
        "\n",
      ),
    ).length,
    50,
  );
});
