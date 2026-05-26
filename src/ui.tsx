import { Button, Container, render, VerticalSpace } from "@create-figma-plugin/ui";
import { h } from "preact";

function Plugin() {
  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      <Button fullWidth>Export tokens</Button>
    </Container>
  );
}

export default render(Plugin);
