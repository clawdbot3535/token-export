import { describe, expect, it } from "vitest";
import { buildExport, type CollectedData } from "./export";

function parse(files: { filename: string; json: string }[], name: string) {
  const f = files.find((x) => x.filename === name);
  if (!f) throw new Error(`missing file ${name}`);
  return JSON.parse(f.json);
}

describe("buildExport — literals", () => {
  it("emits a nested color primitive in the inspector shape", () => {
    const data: CollectedData = {
      collections: [
        {
          id: "C1",
          name: "primitives/color",
          defaultModeId: "m1",
          modes: [{ modeId: "m1", name: "Mode 1" }],
          variables: [
            {
              id: "V1",
              name: "color/white",
              resolvedType: "COLOR",
              valuesByMode: { m1: { r: 1, g: 1, b: 1, a: 1 } },
              scopes: ["ALL_SCOPES"],
              collectionId: "C1",
            },
          ],
        },
      ],
    };

    const { files, warnings } = buildExport(data);
    expect(warnings).toEqual([]);
    const tree = parse(files, "color.tokens.json");
    expect(tree.color.white).toEqual({
      $type: "color",
      $value: { colorSpace: "srgb", components: [1, 1, 1], alpha: 1, hex: "#FFFFFF" },
      $extensions: {
        "com.figma.variableId": "V1",
        "com.figma.scopes": ["ALL_SCOPES"],
      },
    });
  });

  it("emits numeric primitives as $type number", () => {
    const data: CollectedData = {
      collections: [
        {
          id: "C2",
          name: "primitives/dimension",
          defaultModeId: "m1",
          modes: [{ modeId: "m1", name: "Mode 1" }],
          variables: [
            {
              id: "V2",
              name: "spacing/0",
              resolvedType: "FLOAT",
              valuesByMode: { m1: 0 },
              scopes: ["ALL_SCOPES"],
              collectionId: "C2",
            },
          ],
        },
      ],
    };
    const tree = parse(buildExport(data).files, "dimension.tokens.json");
    expect(tree.spacing["0"]).toEqual({
      $type: "number",
      $value: 0,
      $extensions: { "com.figma.variableId": "V2", "com.figma.scopes": ["ALL_SCOPES"] },
    });
  });

  it("warns when a variable has no value for a mode", () => {
    const data: CollectedData = {
      collections: [
        {
          id: "C3",
          name: "primitives/color",
          defaultModeId: "m1",
          modes: [{ modeId: "m1", name: "Mode 1" }],
          variables: [
            {
              id: "V3",
              name: "color/ghost",
              resolvedType: "COLOR",
              valuesByMode: {},
              scopes: [],
              collectionId: "C3",
            },
          ],
        },
      ],
    };
    const { warnings } = buildExport(data);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("color/ghost");
  });
});
