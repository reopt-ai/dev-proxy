import { createRequire } from "node:module";
import { Text, render } from "ink";
import { ExitOnRender } from "../cli/output.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

function Version() {
  return (
    <Text>
      <ExitOnRender />
      dev-proxy v{pkg.version}
    </Text>
  );
}

render(<Version />);
