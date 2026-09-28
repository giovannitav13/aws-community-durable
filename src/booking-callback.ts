import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  LambdaClient,
  SendDurableExecutionCallbackSuccessCommand,
} from "@aws-sdk/client-lambda";
import { jsonResponse, parseJsonBody } from "./http";

interface BookingCallbackRequest {
  callbackId: string;
  approved: boolean;
  slotId?: string;
  reason?: string;
}

const lambda = new LambdaClient({});

export async function handler(event: APIGatewayProxyEventV2) {
  try {
    const payload = parseJsonBody<BookingCallbackRequest>(event.body);
    if (!payload.callbackId || typeof payload.approved !== "boolean") {
      throw new Error("callbackId and approved are required");
    }

    console.log("Completing durable callback", {
      callbackId: payload.callbackId,
      approved: payload.approved,
    });

    await lambda.send(
      new SendDurableExecutionCallbackSuccessCommand({
        CallbackId: payload.callbackId,
        Result: Buffer.from(
          JSON.stringify({
            approved: payload.approved,
            ...(payload.approved
              ? { slotId: payload.slotId ?? "DEFAULT-SLOT" }
              : { reason: payload.reason ?? "The requested appointment was rejected." }),
          }),
        ),
      }),
    );

    return jsonResponse(202, {
      status: payload.approved ? "CALLBACK_APPROVED" : "CALLBACK_REJECTED",
    });
  } catch (error) {
    console.error("Unable to process booking callback", { error });
    return jsonResponse(400, {
      message: error instanceof Error ? error.message : "Invalid request",
    });
  }
}
