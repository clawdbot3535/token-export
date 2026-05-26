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

describe("buildExport — aliases", () => {
  // primitives/color (single mode) + semantic (light/dark) aliasing into it.
  const data: CollectedData = {
    collections: [
      {
        id: "PC",
        name: "primitives/color",
        defaultModeId: "p1",
        modes: [{ modeId: "p1", name: "Mode 1" }],
        variables: [
          {
            id: "WHITE",
            name: "color/white",
            resolvedType: "COLOR",
            valuesByMode: { p1: { r: 1, g: 1, b: 1, a: 1 } },
            scopes: ["ALL_SCOPES"],
            collectionId: "PC",
          },
          {
            id: "BLACK",
            name: "color/black",
            resolvedType: "COLOR",
            valuesByMode: { p1: { r: 0, g: 0, b: 0, a: 1 } },
            scopes: ["ALL_SCOPES"],
            collectionId: "PC",
          },
        ],
      },
      {
        id: "SEM",
        name: "semantic",
        defaultModeId: "light",
        modes: [
          { modeId: "light", name: "light" },
          { modeId: "dark", name: "dark" },
        ],
        variables: [
          {
            id: "BG",
            name: "color/bg/base",
            resolvedType: "COLOR",
            valuesByMode: {
              light: { type: "VARIABLE_ALIAS", id: "WHITE" },
              dark: { type: "VARIABLE_ALIAS", id: "BLACK" },
            },
            scopes: ["ALL_SCOPES"],
            collectionId: "SEM",
          },
        ],
      },
    ],
  };

  it("resolves an alias to the target literal AND records aliasData (light)", () => {
    const tree = parse(buildExport(data).files, "light.tokens.json");
    expect(tree.color.bg.base).toEqual({
      $type: "color",
      $value: { colorSpace: "srgb", components: [1, 1, 1], alpha: 1, hex: "#FFFFFF" },
      $extensions: {
        "com.figma.variableId": "BG",
        "com.figma.scopes": ["ALL_SCOPES"],
        "com.figma.aliasData": {
          targetVariableName: "color/white",
          targetVariableSetName: "primitives/color",
        },
      },
    });
  });

  it("resolves the dark mode to the dark target", () => {
    const tree = parse(buildExport(data).files, "dark.tokens.json");
    expect(tree.color.bg.base.$value.hex).toBe("#000000");
    expect(tree.color.bg.base.$extensions["com.figma.aliasData"].targetVariableName).toBe(
      "color/black",
    );
  });

  it("warns and emits null $value on an unresolvable alias", () => {
    const broken: CollectedData = {
      collections: [
        {
          id: "S",
          name: "semantic",
          defaultModeId: "light",
          modes: [{ modeId: "light", name: "light" }],
          variables: [
            {
              id: "X",
              name: "color/x",
              resolvedType: "COLOR",
              valuesByMode: { light: { type: "VARIABLE_ALIAS", id: "GHOST" } },
              scopes: [],
              collectionId: "S",
            },
          ],
        },
      ],
    };
    const { files, warnings } = buildExport(broken);
    expect(warnings.some((w) => w.includes("color/x"))).toBe(true);
    const tree = parse(files, "light.tokens.json");
    expect(tree.color.x.$value).toBeNull();
  });
});
