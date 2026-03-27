import { useState } from "react";
import { createRequire } from "node:module";
import { Text, render, useApp } from "ink";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

function ExitOnRender() {
  const { exit } = useApp();
  useState(() => {
    setTimeout(exit, 0);
  });
  return null;
}

function Version() {
  return (
    <Text>
      <ExitOnRender />
      dev-proxy v{pkg.version}
    </Text>
  );
}

render(<Version />);
