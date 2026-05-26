import { Button, Container, render, Text, VerticalSpace } from "@create-figma-plugin/ui";
import { emit, on } from "@create-figma-plugin/utilities";
import { strToU8, zipSync } from "fflate";
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ExportResult } from "./export";

function downloadZip(result: ExportResult): void {
  const entries: Record<string, Uint8Array> = {};
  for (const file of result.files) entries[file.filename] = strToU8(file.json);
  const zipped = zipSync(entries); // method 8 (deflate) — inspector unzip supports it
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "tokens.zip";
  anchor.click();
  URL.revokeObjectURL(url);
}

function Plugin() {
  const [status, setStatus] = useState("");

  useEffect(() => {
    const offResult = on("EXPORT_RESULT", (result: ExportResult) => {
      if (result.files.length === 0) {
        setStatus("No variable collections found.");
        return;
      }
      downloadZip(result);
      const warn = result.warnings.length ? ` · ${result.warnings.length} warnings` : "";
      setStatus(`Exported ${result.files.length} file(s)${warn}`);
    });
    const offError = on("EXPORT_ERROR", (message: string) => {
      setStatus(`Error: ${message}`);
    });
    return () => {
      offResult();
      offError();
    };
  }, []);

  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <Button
        fullWidth
        onClick={() => {
          setStatus("Reading variables…");
          emit("EXPORT");
        }}
      >
        Export tokens
      </Button>
      <VerticalSpace space="small" />
      <Text>{status}</Text>
    </Container>
  );
}

export default render(Plugin);
