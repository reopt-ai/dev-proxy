import { Box, Text } from "ink";
import { pairCode, type PairRequest } from "../proxy/pairing.js";
import { palette } from "../utils/format.js";

/**
 * One-line prompt for the oldest pending pair request. The code lets the
 * approver match it against what the joining machine printed.
 */
export function PairPrompt({
  request,
  more,
  confirming,
}: {
  request: PairRequest;
  more: number;
  /** `A` was pressed; waiting for `Y` to actually approve. */
  confirming: boolean;
}) {
  return (
    <Box paddingX={1} gap={1}>
      <Text color={palette.warning} bold>
        PAIR REQUEST
      </Text>
      <Text color={palette.text} bold>
        {request.name}
      </Text>
      <Text color={palette.muted}>{request.address}</Text>
      <Text color={palette.subtle}>{"│"}</Text>
      <Text color={palette.muted}>code</Text>
      <Text color={palette.accent} bold>
        {pairCode(request.tokenHash)}
      </Text>
      <Text color={palette.subtle}>{"│"}</Text>
      {confirming ? (
        <>
          <Text color={palette.warning} bold>
            APPROVE?
          </Text>
          <Text color={palette.accent} bold>
            Y
          </Text>
          <Text color={palette.muted}>CONFIRM</Text>
          <Text color={palette.dim}>any other key cancels</Text>
        </>
      ) : (
        <>
          <Text color={palette.accent} bold>
            A
          </Text>
          <Text color={palette.muted}>APPROVE</Text>
          <Text color={palette.accent} bold>
            D
          </Text>
          <Text color={palette.muted}>DENY</Text>
        </>
      )}
      {more > 0 && <Text color={palette.dim}>+{more} more</Text>}
    </Box>
  );
}
