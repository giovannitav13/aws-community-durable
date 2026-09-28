import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

export function parseJsonBody<T>(body: string | undefined): T {
  if (!body) {
    throw new Error("Missing JSON body");
  }

  return JSON.parse(body) as T;
}
