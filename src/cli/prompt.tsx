import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";

export function TextPrompt({
  label,
  defaultValue,
  onSubmit,
}: {
  label: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <Box>
      <Text>{"  "}</Text>
      <Text bold>{label}</Text>
      {defaultValue && <Text dimColor>{` (${defaultValue})`}</Text>}
      <Text>{": "}</Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => {
          const trimmed = v.trim();
          onSubmit(trimmed ? trimmed : (defaultValue ?? ""));
        }}
      />
    </Box>
  );
}

export function Confirm({
  message,
  defaultYes = true,
  onConfirm,
}: {
  message: string;
  defaultYes?: boolean;
  onConfirm: (yes: boolean) => void;
}) {
  const hint = defaultYes ? "Y/n" : "y/N";

  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") onConfirm(true);
    else if (key === "n") onConfirm(false);
    else if (key === "\r" || key === "") onConfirm(defaultYes);
  });

  return (
    <Box>
      <Text>{"  "}</Text>
      <Text>{message}</Text>
      <Text dimColor>{` [${hint}] `}</Text>
    </Box>
  );
}

export function ExitAfterRender() {
  const { exit } = useApp();
  useState(() => {
    // Schedule exit after current render completes
    setTimeout(() => {
      exit();
    }, 0);
  });
  return null;
}
