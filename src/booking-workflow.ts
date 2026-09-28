import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { DurableContext, withDurableExecution } from "@aws/durable-execution-sdk-js";

interface BookingWorkflowInput {
  requestId: string;
  patientId: string;
  requestedDate: string;
  email: string;
}

interface BookingCallbackResult {
  approved: boolean;
  slotId?: string;
}

const senderEmail = process.env.SENDER_EMAIL!;

const ses = new SESClient({});

export const handler = withDurableExecution(async (event: BookingWorkflowInput, context: DurableContext) => {
  console.log("Workflow started", {
    requestId: event.requestId,
    patientId: event.patientId,
    requestedDate: event.requestedDate,
  });

  await context.step("simulate-initial-validation", async () => {
    console.log("Initial validation completed", { requestId: event.requestId });
    return {
      validPatient: true,
      validRequestedDate: true,
    };
  });

  let callbackResult: BookingCallbackResult | undefined;

  try {
    console.log("Workflow suspending for async booking callback", {
      requestId: event.requestId,
    });

    // con createCallback AWS restituisce:
    // - callbackPromise, che verra risolta quando arrivera la risposta esterna
    // - callbackId, l'identificativo da comunicare al sistema esterno
    // Non impostiamo un timeout specifico, vale solo il limite globale della Durable Function.
    const [callbackPromise, callbackId] = await context.createCallback<BookingCallbackResult | string>(
      "wait-for-medical-office-confirmation",
    );

    // Nell'esempio il sistema esterno non esiste, ma banalmente chiameremo un qualsiasi endpoint passando tra i vari valori anche callbackId
    //logghiamo callbackId che recuperemo dai log di cloudwatch
    console.log("Callback created; workflow is now waiting", {
      requestId: event.requestId,
      callbackId,
    });

    // Qui il workflow va realmente in wait
    // AWS persiste lo stato
    // riprende l'esecuzione alla callback
    const rawCallbackResult = await callbackPromise;

    callbackResult = normalizeCallbackResult(rawCallbackResult);
  } catch (error) {
    // Il catch viene eseguito se
    // 1. un sistema completa il callback tramite SendDurableExecutionCallbackFailure;
    // 2. la callback restituisce un payload che non riusciamo a validare.
    // Non gestisce la scadenza di ExecutionTimeout: in quel caso AWS interrompe direttamente l'intera esecuzione della Durable Function.
    console.error("Callback processing failed", {
      requestId: event.requestId,
      error,
    });

    // Anche l'invio dell'email e uno step durevole: in caso di replay, AWS non
    // ripete l'effetto collaterale se lo step risulta gia completato.
    await context.step("send-callback-failure-email", async () => {
      await sendFinalEmail(event, "FAILED", "Non e stato possibile completare la prenotazione.");
    });

    // Il valore restituito diventa il risultato finale dell'esecuzione durevole.
    return {
      requestId: event.requestId,
      status: "FAILED",
      reason: error instanceof Error ? error.message : "Callback failed",
    };
  }

  // Questo log viene raggiunto soltanto dopo che callbackPromise e stata risolta
  // e il workflow e stato ripreso dal checkpoint persistito da AWS.
  console.log("Workflow resumed from callback", {
    requestId: event.requestId,
    callbackResult,
  });

  // Esito positivo comunicato dal centro medico.
  if (callbackResult?.approved) {
    // SES e racchiuso in uno step per evitare invii duplicati durante il replay.
    await context.step("send-confirmation-email", async () => {
      await sendFinalEmail(
        event,
        "CONFIRMED",
        `Prenotazione confermata per il ${event.requestedDate}. Slot: ${callbackResult?.slotId ?? "assegnato"}.`,
      );
    });

    console.log("Workflow completed successfully", { requestId: event.requestId });

    // La Durable Function termina restituendo conferma e slot assegnato.
    return {
      requestId: event.requestId,
      status: "CONFIRMED",
      slotId: callbackResult.slotId,
    };
  }

  // Un rifiuto e un normale risultato di business, non un errore tecnico:
  // la callback e completata con successo, ma contiene approved: false.
  await context.step("send-failure-email", async () => {
    await sendFinalEmail(event, "FAILED", "La prenotazione e stata rifiutata dalla struttura.");
  });

  console.log("Workflow completed with rejection", { requestId: event.requestId });

  // Il workflow termina regolarmente con stato REJECTED.
  return {
    requestId: event.requestId,
    status: "REJECTED",
  };
});

function normalizeCallbackResult(result: BookingCallbackResult | string): BookingCallbackResult {
  let parsedResult: unknown = result;

  if (typeof result === "string") {
    try {
      parsedResult = JSON.parse(result) as unknown;
    } catch (error) {
      console.error("Unable to parse durable callback result", {
        result,
        error,
      });
      throw new Error("Invalid durable callback result: expected JSON object string");
    }
  }

  if (!isBookingCallbackResult(parsedResult)) {
    console.error("Invalid durable callback result shape", {
      result: parsedResult,
    });
    throw new Error("Invalid durable callback result: missing approved boolean");
  }

  return parsedResult;
}

function isBookingCallbackResult(result: unknown): result is BookingCallbackResult {
  return (
    typeof result === "object" &&
    result !== null &&
    typeof (result as BookingCallbackResult).approved === "boolean"
  );
}

async function sendFinalEmail(event: BookingWorkflowInput, status: "CONFIRMED" | "FAILED", message: string) {
  await ses.send(
    new SendEmailCommand({
      Source: senderEmail,
      Destination: {
        ToAddresses: [event.email],
      },
      Message: {
        Subject: {
          Data: `Prenotazione visita medica: ${status}`,
          Charset: "UTF-8",
        },
        Body: {
          Text: {
            Data: [
              `Richiesta: ${event.requestId}`,
              `Paziente: ${event.patientId}`,
              `Data richiesta: ${event.requestedDate}`,
              "",
              message,
            ].join("\n"),
            Charset: "UTF-8",
          },
        },
      },
    }),
  );
}
