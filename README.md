# AWS Lambda Durable Functions: prenotazione visita medica

Esempio didattico in AWS CDK TypeScript per mostrare un workflow con AWS Lambda Durable Functions, sospensione asincrona e ripresa tramite callback.

Il caso d'uso simula la prenotazione di una visita medica:

```text
API Gateway
  POST /booking
    -> Lambda starter
    -> Lambda Durable Function
    -> createCallback
    -> attesa callbackPromise
    -> POST /booking/callback
    -> ripresa workflow
    -> Amazon SES
```

## Architettura

- `BookingWorkflowStack`: crea API Gateway, Lambda di start, Lambda di callback, Lambda Durable Function e permessi IAM.
- `POST /booking`: valida il payload, genera un `requestId`, invoca la Durable Function in modo asincrono e risponde subito `202`.
- Durable Function: simula una validazione, genera un `callbackId` con `createCallback`, attende la relativa promise e riprende quando arriva la callback.
- `POST /booking/callback`: riceve direttamente il `callbackId` e inoltra l'esito ad AWS con `SendDurableExecutionCallbackSuccess`.
- Amazon SES: invia email finale di conferma o fallimento/scadenza.

La Durable Function conserva lo stato e il punto di sospensione senza appoggiarsi a un database applicativo. In questo esempio il sistema esterno e simulato manualmente leggendo il `callbackId` dai log CloudWatch.

La funzione usa `DurableConfig` su `AWS::Lambda::Function`. Il progetto applica questa proprietà tramite override CDK perché il supporto L2 può dipendere dalla versione di `aws-cdk-lib`.

## Prerequisiti

- Node.js 24 o compatibile con il runtime scelto.
- AWS CDK v2.
- Credenziali AWS configurate.
- Bootstrap CDK già eseguito nell'account/region:

```bash
npx cdk bootstrap
```

- Un indirizzo mittente verificato in Amazon SES. In sandbox SES deve essere verificato anche il destinatario usato nel test.
- Disponibilità di AWS Lambda Durable Functions nella region scelta.

## Installazione

```bash
npm install
npm run build
```

## Deploy

Creare un file `.env` partendo da `.env.example`:

```bash
SENDER_EMAIL=verified-sender@example.com
DURABLE_EXECUTION_TIMEOUT_SECONDS=900
```

Poi eseguire:

```bash
npm run deploy
```

In alternativa, passare i parametri direttamente a CDK:

```bash
npx cdk deploy --all \
  --parameters BookingWorkflowStack:SenderEmail=verified-sender@example.com \
  --parameters BookingWorkflowStack:DurableExecutionTimeoutSeconds=900
```

Al termine del deploy, copia l'output `BookingWorkflowStack.BookingApiUrl`.

## Test: avvio prenotazione

```bash
API_URL="https://xxxxxxxxxx.execute-api.eu-west-1.amazonaws.com"

curl -X POST "$API_URL/booking" \
  -H "content-type: application/json" \
  -d '{
    "patientId": "P12345",
    "requestedDate": "2026-10-15",
    "email": "user@example.com"
  }'
```

Risposta attesa:

```json
{
  "requestId": "uuid-generato",
  "status": "STARTED",
  "message": "Booking workflow accepted."
}
```

## Test: callback positiva

Recupera il `callbackId` dai log CloudWatch della Durable Function e usalo nella richiesta:

```bash
curl -X POST "$API_URL/booking/callback" \
  -H "content-type: application/json" \
  -d '{
    "callbackId": "callback-id-dai-log",
    "approved": true,
    "slotId": "VISIT-2026-10-15-09-30"
  }'
```

## Test: callback negativa

```bash
curl -X POST "$API_URL/booking/callback" \
  -H "content-type: application/json" \
  -d '{
    "callbackId": "callback-id-dai-log",
    "approved": false,
    "reason": "Nessuno slot disponibile"
  }'
```

## Test: execution timeout

Imposta `DurableExecutionTimeoutSeconds` a un valore breve, per esempio `60`, avvia una prenotazione e non inviare la callback.

La callback non ha un timeout dedicato. La Durable Function resta sospesa senza consumare compute durante l'attesa e termina soltanto quando riceve una callback oppure quando scade il timeout complessivo dell'esecuzione.

## Cosa osservare in CloudWatch Logs

Log della Lambda starter:

- `Starting durable booking workflow`: richiesta ricevuta e workflow avviato.

Log della Durable Function:

- `Workflow started`: inizio durable execution.
- `Initial validation completed`: step applicativo completato e checkpointato.
- `Workflow suspending for async booking callback`: ingresso nell'attesa asincrona.
- `Callback created; workflow is now waiting`: callback creata e workflow sospeso; il log contiene il `callbackId` da usare nel test.
- `Workflow resumed from callback`: ripresa dopo `POST /booking/callback`.
- `Workflow completed successfully`, `Workflow completed with rejection` oppure `Callback processing failed`: esito finale.

Log della Lambda callback:

- `Completing durable callback`: endpoint callback chiamato e risultato inoltrato alla Durable Function.

Durante la ripresa, il codice della Durable Function viene rieseguito secondo il modello checkpoint/replay: gli step già completati non rieseguono gli effetti collaterali, ma restituiscono il risultato persistito dal runtime durable.

## Riferimenti AWS verificati

- AWS Lambda Durable Functions: `https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html`
- Configurazione `DurableConfig`: `https://docs.aws.amazon.com/lambda/latest/dg/durable-configuration.html`
- Durable Execution SDK: `https://docs.aws.amazon.com/lambda/latest/dg/durable-execution-sdk.html`
- Callback SDK/API: `https://docs.aws.amazon.com/durable-execution/sdk-reference/operations/callback/`
