import { Box, Text } from "ink";

const DIVIDER = "─".repeat(44);

export function Header({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{`  ${text}`}</Text>
      <Text dimColor>{`  ${DIVIDER}`}</Text>
    </Box>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">{`  ${title}`}</Text>
      {children}
    </Box>
  );
}

export function Row({
  label,
  value,
  pad = 14,
}: {
  label: string;
  value: string;
  pad?: number;
}) {
  return (
    <Text>
      {"    "}
      <Text dimColor>{label.padEnd(pad)}</Text>
      <Text>{value}</Text>
    </Text>
  );
}

export function RouteRow({
  sub,
  target,
  pad = 14,
}: {
  sub: string;
  target: string;
  pad?: number;
}) {
  return (
    <Text>
      {"    "}
      <Text color={sub === "*" ? "yellow" : "cyan"}>{sub.padEnd(pad)}</Text>
      <Text dimColor>{"\u279C "}</Text>
      <Text>{target}</Text>
    </Text>
  );
}

export function Check({
  ok,
  warn,
  label,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
}) {
  const symbol = ok ? "\u2713" : warn ? "\u26A0" : "\u2717";
  const color = ok ? "green" : warn ? "yellow" : "red";
  return (
    <Text>
      {"    "}
      <Text color={color}>{symbol}</Text>
      <Text>{` ${label}`}</Text>
    </Text>
  );
}

export function Hint({ text }: { text: string }) {
  return <Text dimColor>{`    ${text}`}</Text>;
}

export function ErrorMessage({ message, hint }: { message: string; hint?: string }) {
  return (
    <Box flexDirection="column">
      <Text>
        {"  "}
        <Text color="red">{"\u2717"}</Text>
        <Text>{` ${message}`}</Text>
      </Text>
      {hint && <Hint text={hint} />}
    </Box>
  );
}

export function SuccessMessage({ message }: { message: string }) {
  return (
    <Text>
      {"  "}
      <Text color="green">{"\u2713"}</Text>
      <Text>{` ${message}`}</Text>
    </Text>
  );
}
