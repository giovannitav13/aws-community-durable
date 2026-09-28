import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { InvokeCommand, InvocationType, LambdaClient } from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";
import { jsonResponse, parseJsonBody } from "./http";

interface BookingRequest {
  patientId: string;
  requestedDate: string;
  email: string;
}

const lambda = new LambdaClient({});

export async function handler(event: APIGatewayProxyEventV2) {
  try {
    const payload = parseJsonBody<BookingRequest>(event.body);
    validatePayload(payload);

    const requestId = randomUUID();

    console.log("Starting durable booking workflow", {
      requestId,
      patientId: payload.patientId,
      requestedDate: payload.requestedDate,
    });

    await lambda.send(
      new InvokeCommand({
        FunctionName: process.env.BOOKING_WORKFLOW_FUNCTION_ARN,
        InvocationType: InvocationType.Event,
        Payload: Buffer.from(
          JSON.stringify({
            requestId,
            ...payload,
          }),
        ),
      }),
    );

    return jsonResponse(202, {
      requestId,
      status: "STARTED",
      message: "Booking workflow accepted.",
    });
  } catch (error) {
    console.error("Unable to start booking workflow", { error });
    return jsonResponse(400, {
      message: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

function validatePayload(payload: BookingRequest) {
  if (!payload.patientId || !payload.requestedDate || !payload.email) {
    throw new Error("patientId, requestedDate and email are required");
  }
}
