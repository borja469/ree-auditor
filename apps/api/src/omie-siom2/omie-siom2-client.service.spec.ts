import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as forge from "node-forge";
import { OmieSiom2ClientService } from "./omie-siom2-client.service";
import type { OmieSiom2RequestOptions, OmieSiom2Response } from "./omie-siom2.types";
import { OmieXmlSigner } from "./signature/omie-xml-signer";
import { OmieSoapBuilder } from "./soap/omie-soap-builder";

const https = require("node:https") as typeof import("node:https");

const PASS_PHRASE = "test-passphrase";
const P12_BUFFER = createTestPkcs12(PASS_PHRASE);
const OMIE_ENV_KEYS = ["OMIE_SIOM2_P12_PATH", "OMIE_SIOM2_P12_BASE64", "OMIE_SIOM2_P12_PASSPHRASE"] as const;
const CONSULTA_DATOS_USUARIO_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">',
  "<soapenv:Body>",
  '<ns2:ServicioConsultaDatosUsuarioResponse xmlns:ns2="http://www.omel.es/SIOMServiceRouter">',
  "<return>",
  "<codigoAgente>AGENTE01</codigoAgente>",
  '<unidad codigo="U1"><rol>VENDEDOR</rol></unidad>',
  '<unidad codigo="U2"><rol>COMPRADOR</rol></unidad>',
  "</return>",
  "</ns2:ServicioConsultaDatosUsuarioResponse>",
  "</soapenv:Body>",
  "</soapenv:Envelope>"
].join("");

void describe("OmieSiom2ClientService.createSignedSoapRequest", () => {
  let previousEnv: Record<(typeof OMIE_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    previousEnv = snapshotOmieEnv();
    clearOmieCertificateEnv();
  });

  afterEach(() => {
    restoreOmieEnv(previousEnv);
  });

  void it("generates a signed SOAP request for ServicioConsultaDatosUsuario", async () => {
    configurePkcs12Env();

    const signedSoap = await createService().createSignedSoapRequest("ServicioConsultaDatosUsuario");

    assert.match(signedSoap, /<ServicioConsultaDatosUsuario\b/);
    assertSignedOmieSoap(signedSoap);
  });

  void it("generates a signed SOAP request with payload for ServicioAltaOfertasMD", async () => {
    configurePkcs12Env();

    const signedSoap = await createService().createSignedSoapRequest(
      "ServicioAltaOfertasMD",
      "<MensajeOfertasMD><Oferta id=\"1\"/></MensajeOfertasMD>"
    );

    assert.match(signedSoap, /<ServicioAltaOfertasMD\b/);
    assert.match(signedSoap, /<MensajeOfertasMD><Oferta id="1"\/><\/MensajeOfertasMD>/);
    assertSignedOmieSoap(signedSoap);
  });

  void it("throws a clear error when the PKCS12 certificate is not configured", async () => {
    await assert.rejects(() => createService().createSignedSoapRequest("ServicioConsultaDatosUsuario"), {
      name: "OmieSiom2ConnectionError",
      message: "OMIE SIOM2 PKCS12 certificate is not configured"
    });
  });
});

void describe("OmieSiom2ClientService.invokeRaw", () => {
  let previousEnv: Record<(typeof OMIE_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    previousEnv = snapshotOmieEnv();
    clearOmieCertificateEnv();
  });

  afterEach(() => {
    restoreOmieEnv(previousEnv);
  });

  void it("sends the signed SOAP as a raw POST and returns the raw response", async () => {
    configurePkcs12Env();
    const service = new CapturingOmieSiom2ClientService();

    const response = await service.invokeRaw("ServicioConsultaDatosUsuario");

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.headers, {
      "content-type": "text/xml; charset=utf-8",
      "set-cookie": ["session=abc"]
    });
    assert.equal(response.body, "<soapenv:Envelope>raw response</soapenv:Envelope>");
    assert.equal(service.lastRequest?.method, "POST");
    assert.equal(service.lastRequest?.headers?.["Content-Type"], "text/xml; charset=utf-8");
    assert.equal(service.lastRequest?.headers?.SOAPAction, "");
    assert.equal(typeof service.lastRequest?.body, "string");
    assertSignedOmieSoap(String(service.lastRequest?.body));
  });

  void it("testConnection invokes ServicioConsultaDatosUsuario without payload", async () => {
    const service = new TestConnectionOmieSiom2ClientService();

    const response = await service.testConnection();

    assert.equal(response.statusCode, 204);
    assert.equal(response.body, "ok");
    assert.deepEqual(service.signedRequestArgs, {
      serviceName: "ServicioConsultaDatosUsuario",
      xmlPayload: undefined
    });
    assert.equal(service.lastRequest?.method, "POST");
    assert.equal(service.lastRequest?.headers?.SOAPAction, "");
    assert.equal(service.lastRequest?.body, "<signed-soap/>");
  });

  void it("testConnectionJson returns the raw XML and a parsed JSON object", async () => {
    const service = new TestConnectionJsonOmieSiom2ClientService();

    const response = await service.testConnectionJson();

    assert.equal(response.statusCode, 200);
    assert.equal(response.serviceName, "ServicioConsultaDatosUsuario");
    assert.equal(response.xml, CONSULTA_DATOS_USUARIO_XML);
    assert.deepEqual(response.json, {
      "soapenv:Envelope": {
        $attributes: {
          "xmlns:soapenv": "http://schemas.xmlsoap.org/soap/envelope/"
        },
        "soapenv:Body": {
          "ns2:ServicioConsultaDatosUsuarioResponse": {
            $attributes: {
              "xmlns:ns2": "http://www.omel.es/SIOMServiceRouter"
            },
            return: {
              codigoAgente: "AGENTE01",
              unidad: [
                {
                  $attributes: {
                    codigo: "U1"
                  },
                  rol: "VENDEDOR"
                },
                {
                  $attributes: {
                    codigo: "U2"
                  },
                  rol: "COMPRADOR"
                }
              ]
            }
          }
        }
      }
    });
    assert.deepEqual(service.signedRequestArgs, {
      serviceName: "ServicioConsultaDatosUsuario",
      xmlPayload: undefined
    });
  });

  void it("base service methods invoke their corresponding OMIE service without payload and parse XML", async () => {
    const cases: Array<{
      serviceName: string;
      invoke: (service: TestConnectionJsonOmieSiom2ClientService) => Promise<{ serviceName: string; statusCode: number; xml: string; json: unknown }>;
    }> = [
      {
        serviceName: "ServicioConsultaDatosUsuario",
        invoke: (service) => service.consultaDatosUsuario()
      },
      {
        serviceName: "ServicioConsultaFechaHora",
        invoke: (service) => service.consultaFechaHora()
      },
      {
        serviceName: "ServicioConsultaMercados",
        invoke: (service) => service.consultaMercados()
      },
      {
        serviceName: "ServicioConsultaDirectorioConsultas",
        invoke: (service) => service.consultaDirectorioConsultas()
      }
    ];

    for (const testCase of cases) {
      const service = new TestConnectionJsonOmieSiom2ClientService();

      const response = await testCase.invoke(service);

      assert.equal(response.statusCode, 200);
      assert.equal(response.serviceName, testCase.serviceName);
      assert.equal(response.xml, CONSULTA_DATOS_USUARIO_XML);
      assert.equal(typeof response.json, "object");
      assert.deepEqual(service.signedRequestArgs, {
        serviceName: testCase.serviceName,
        xmlPayload: undefined
      });
    }
  });

  void it("consultaConfiguracionConsulta invokes OMIE with CodConsulta payload and parses XML", async () => {
    const service = new TestConnectionJsonOmieSiom2ClientService();

    const response = await service.consultaConfiguracionConsulta(" 5159 ");

    assert.equal(response.statusCode, 200);
    assert.equal(response.serviceName, "ServicioConsultaConfiguracionConsulta");
    assert.equal(response.xml, CONSULTA_DATOS_USUARIO_XML);
    assert.deepEqual(service.signedRequestArgs, {
      serviceName: "ServicioConsultaConfiguracionConsulta",
      xmlPayload: '<CodConsulta v="5159"/>'
    });
  });

  void it("consultaConfiguracionConsulta escapes CodConsulta as XML attribute payload", async () => {
    const service = new TestConnectionJsonOmieSiom2ClientService();

    await service.consultaConfiguracionConsulta('5"&<>\'');

    assert.deepEqual(service.signedRequestArgs, {
      serviceName: "ServicioConsultaConfiguracionConsulta",
      xmlPayload: '<CodConsulta v="5&quot;&amp;&lt;&gt;&apos;"/>'
    });
  });
});

void describe("OmieSiom2ClientService.request retry behavior", { concurrency: false }, () => {
  let previousEnv: Record<(typeof OMIE_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    previousEnv = snapshotOmieEnv();
    configurePkcs12Env();
  });

  afterEach(() => {
    restoreOmieEnv(previousEnv);
  });

  void it("retries transient DNS errors and succeeds on the second attempt", async () => {
    const harness = createRetryHarness([
      { kind: "error", code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN www.mercado.omie.es" },
      { kind: "success", body: "<ok>second</ok>" }
    ]);

    try {
      const response = await harness.service.request({ method: "POST" });

      assert.equal(harness.calls.length, 2);
      assert.equal(response.body, "<ok>second</ok>");
      assert.equal(response.statusCode, 200);
      assert.equal(harness.logs.some((entry) => entry.message.includes("host=www.mercado.omie.es")), true);
      assert.equal(harness.logs.some((entry) => entry.message.includes("attempt=2/3")), true);
      assert.equal(harness.logs.some((entry) => entry.message.includes("code=EAI_AGAIN")), true);
      assert.equal(harness.logs.some((entry) => entry.message.includes("durationMs=")), true);
    } finally {
      harness.restore();
    }
  });

  void it("succeeds on the first attempt without retries", async () => {
    const harness = createRetryHarness([{ kind: "success", body: "<ok>first</ok>" }]);

    try {
      const response = await harness.service.request({ method: "POST" });

      assert.equal(harness.calls.length, 1);
      assert.equal(response.body, "<ok>first</ok>");
      assert.equal(response.statusCode, 200);
      assert.equal(harness.logs.some((entry) => entry.message.includes("attempt=1/3")), true);
      assert.equal(harness.logs.some((entry) => entry.message.includes("retry")), false);
    } finally {
      harness.restore();
    }
  });

  void it("retries EAI_AGAIN up to three attempts and preserves the original message", async () => {
    const harness = createRetryHarness([
      { kind: "error", code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN www.mercado.omie.es" },
      { kind: "error", code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN www.mercado.omie.es" },
      { kind: "error", code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN www.mercado.omie.es" }
    ]);

    try {
      await assert.rejects(() => harness.service.request({ method: "POST" }), {
        message: "getaddrinfo EAI_AGAIN www.mercado.omie.es"
      });
      assert.equal(harness.calls.length, 3);
      assert.equal(harness.logs.some((entry) => entry.message.includes("attempt=3/3")), true);
      assert.equal(harness.logs.some((entry) => entry.message.includes("final failure")), true);
    } finally {
      harness.restore();
    }
  });

  void it("retries ENOTFOUND and succeeds on the second attempt", async () => {
    const harness = createRetryHarness([
      { kind: "error", code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND www.mercado.omie.es" },
      { kind: "success", body: "<ok>enotfound</ok>" }
    ]);

    try {
      const response = await harness.service.request({ method: "POST" });

      assert.equal(harness.calls.length, 2);
      assert.equal(response.body, "<ok>enotfound</ok>");
    } finally {
      harness.restore();
    }
  });

  void it("retries ECONNRESET and succeeds on the second attempt", async () => {
    const harness = createRetryHarness([
      { kind: "error", code: "ECONNRESET", message: "socket hang up" },
      { kind: "success", body: "<ok>reset</ok>" }
    ]);

    try {
      const response = await harness.service.request({ method: "POST" });

      assert.equal(harness.calls.length, 2);
      assert.equal(response.body, "<ok>reset</ok>");
    } finally {
      harness.restore();
    }
  });

  void it("retries ETIMEDOUT and succeeds on the second attempt", async () => {
    const harness = createRetryHarness([
      { kind: "timeout", message: "Timeout conectando con SIOM2 tras 30000 ms." },
      { kind: "success", body: "<ok>timeout</ok>" }
    ]);

    try {
      const response = await harness.service.request({ method: "POST" });

      assert.equal(harness.calls.length, 2);
      assert.equal(response.body, "<ok>timeout</ok>");
      assert.equal(harness.logs.some((entry) => entry.message.includes("code=ETIMEDOUT")), true);
    } finally {
      harness.restore();
    }
  });

  void it("retries ENOTFOUND up to three attempts and propagates the final error", async () => {
    const harness = createRetryHarness([
      { kind: "error", code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND www.mercado.omie.es" },
      { kind: "error", code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND www.mercado.omie.es" },
      { kind: "error", code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND www.mercado.omie.es" }
    ]);

    try {
      await assert.rejects(() => harness.service.request({ method: "POST" }), {
        message: "getaddrinfo ENOTFOUND www.mercado.omie.es"
      });
      assert.equal(harness.calls.length, 3);
    } finally {
      harness.restore();
    }
  });

  void it("does not retry non-retriable errors", async () => {
    const harness = createRetryHarness([
      { kind: "error", code: "EACCES", message: "SOAP error" }
    ]);

    try {
      await assert.rejects(() => harness.service.request({ method: "POST" }), {
        message: "SOAP error"
      });
      assert.equal(harness.calls.length, 1);
      assert.equal(harness.logs.some((entry) => entry.message.includes("attempt=1/3")), true);
      assert.equal(harness.logs.some((entry) => entry.message.includes("retry")), false);
    } finally {
      harness.restore();
    }
  });

  void it("retries after an internal timeout and succeeds on the next attempt", async () => {
    const harness = createRetryHarness([
      { kind: "timeout", message: "Timeout conectando con SIOM2 tras 30000 ms." },
      { kind: "success", body: "<ok>timeout-retry</ok>" }
    ]);

    try {
      const response = await harness.service.request({ method: "POST" });

      assert.equal(harness.calls.length, 2);
      assert.equal(response.body, "<ok>timeout-retry</ok>");
      assert.equal(harness.logs.some((entry) => entry.message.includes("code=ETIMEDOUT")), true);
    } finally {
      harness.restore();
    }
  });

  void it("logs host attempt code and duration", async () => {
    const harness = createRetryHarness([
      { kind: "error", code: "EAI_AGAIN", message: "getaddrinfo EAI_AGAIN www.mercado.omie.es" },
      { kind: "success", body: "<ok>logs</ok>" }
    ]);

    try {
      await harness.service.request({ method: "POST" });

      const joined = harness.logs.map((entry) => entry.message).join("\n");
      assert.match(joined, /host=/);
      assert.match(joined, /attempt=/);
      assert.match(joined, /code=/);
      assert.match(joined, /durationMs=/);
    } finally {
      harness.restore();
    }
  });
});

function createService() {
  return new OmieSiom2ClientService(new OmieSoapBuilder(), new OmieXmlSigner());
}

type RetryOutcome =
  | {
      kind: "success";
      statusCode?: number;
      statusMessage?: string;
      headers?: Record<string, string | string[]>;
      body?: string;
    }
  | {
      kind: "error";
      code?: string;
      message: string;
    }
  | {
      kind: "timeout";
      message: string;
    };

function createRetryHarness(outcomes: RetryOutcome[]) {
  const calls: Array<{ url: string; options: unknown }> = [];
  const logs: Array<{ level: string; message: string }> = [];
  const service = createService();
  const requestMock = mock.method(
    https,
    "request",
    ((url: unknown, options: unknown, callback: (response: unknown) => void) => {
      calls.push({ url: String(url), options });
      const outcome = outcomes[Math.min(calls.length, outcomes.length) - 1];
      const request = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: (error?: Error) => void;
      };

      request.write = () => undefined;
      request.destroy = (error?: Error) => {
        if (error) {
          request.emit("error", error);
        }
      };
      request.end = () => {
        if (outcome.kind === "success") {
          const response = new EventEmitter() as EventEmitter & {
            statusCode?: number;
            statusMessage?: string;
            headers: Record<string, string | string[]>;
          };
          response.statusCode = outcome.statusCode ?? 200;
          response.statusMessage = outcome.statusMessage ?? "OK";
          response.headers = outcome.headers ?? { "content-type": "text/xml; charset=utf-8" };
          callback(response);
          response.emit("data", Buffer.from(outcome.body ?? "<ok/>", "utf8"));
          response.emit("end");
          return;
        }

        if (outcome.kind === "error") {
          const error = Object.assign(new Error(outcome.message), { code: outcome.code });
          request.emit("error", error);
          return;
        }

        request.emit("timeout");
      };

      return request;
    }) as unknown as typeof https.request
  );
  const timeoutMock = mock.method(globalThis, "setTimeout", ((callback: (...args: unknown[]) => void, _ms?: number, ...args: unknown[]) => {
    callback(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  (service as unknown as { logger: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void } }).logger = {
    log: (...args: unknown[]) => {
      logs.push({ level: "log", message: formatLogMessage(args) });
    },
    warn: (...args: unknown[]) => {
      logs.push({ level: "warn", message: formatLogMessage(args) });
    },
    error: (...args: unknown[]) => {
      logs.push({ level: "error", message: formatLogMessage(args) });
    },
    debug: (...args: unknown[]) => {
      logs.push({ level: "debug", message: formatLogMessage(args) });
    }
  };

  return {
    service,
    calls,
    logs,
    restore: () => {
      requestMock.mock.restore();
      timeoutMock.mock.restore();
    }
  };
}

function formatLogMessage(args: unknown[]) {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === "object" && arg !== null) {
        return JSON.stringify(arg);
      }
      return String(arg);
    })
    .join(" ");
}

class CapturingOmieSiom2ClientService extends OmieSiom2ClientService {
  lastRequest?: OmieSiom2RequestOptions;

  constructor() {
    super(new OmieSoapBuilder(), new OmieXmlSigner());
  }

  override async request(options: OmieSiom2RequestOptions = {}): Promise<OmieSiom2Response> {
    this.lastRequest = options;
    const body = "<soapenv:Envelope>raw response</soapenv:Envelope>";
    return {
      statusCode: 200,
      statusMessage: "OK",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        "set-cookie": ["session=abc"],
        "x-empty": undefined
      },
      body,
      rawBody: Buffer.from(body, "utf8")
    };
  }
}

class TestConnectionOmieSiom2ClientService extends CapturingOmieSiom2ClientService {
  signedRequestArgs?: {
    serviceName: string;
    xmlPayload?: string;
  };

  override async createSignedSoapRequest(serviceName: string, xmlPayload?: string): Promise<string> {
    this.signedRequestArgs = { serviceName, xmlPayload };
    return "<signed-soap/>";
  }

  override async request(options: OmieSiom2RequestOptions = {}): Promise<OmieSiom2Response> {
    this.lastRequest = options;
    return {
      statusCode: 204,
      statusMessage: "No Content",
      headers: {},
      body: "ok",
      rawBody: Buffer.from("ok", "utf8")
    };
  }
}

class TestConnectionJsonOmieSiom2ClientService extends TestConnectionOmieSiom2ClientService {
  override async request(options: OmieSiom2RequestOptions = {}): Promise<OmieSiom2Response> {
    this.lastRequest = options;
    return {
      statusCode: 200,
      statusMessage: "OK",
      headers: {},
      body: CONSULTA_DATOS_USUARIO_XML,
      rawBody: Buffer.from(CONSULTA_DATOS_USUARIO_XML, "utf8")
    };
  }
}

function configurePkcs12Env() {
  process.env.OMIE_SIOM2_P12_BASE64 = P12_BUFFER.toString("base64");
  process.env.OMIE_SIOM2_P12_PASSPHRASE = PASS_PHRASE;
}

function assertSignedOmieSoap(signedSoap: string) {
  assert.match(signedSoap, /<soapenv:Envelope\b/);
  assert.match(signedSoap, /<soapenv:Header\b/);
  assert.match(signedSoap, /<SOAP-SEC:Signature\b/);
  assert.match(signedSoap, /<ds:Signature\b/);
  assert.match(signedSoap, /<ds:SignedInfo\b/);
  assert.match(signedSoap, /<ds:SignatureValue>/);
  assert.match(signedSoap, /<ds:KeyInfo>/);
  assert.match(signedSoap, /<ds:X509Certificate>/);
  assert.match(signedSoap, /<soapenv:Body\b/);
  assert.match(signedSoap, /\bSOAP-SEC:id="DS-OMEL"/);
  assert.match(signedSoap, /<ds:Reference\b[^>]*\bURI="#DS-OMEL"/);
}

function snapshotOmieEnv() {
  return Object.fromEntries(OMIE_ENV_KEYS.map((key) => [key, process.env[key]])) as Record<(typeof OMIE_ENV_KEYS)[number], string | undefined>;
}

function clearOmieCertificateEnv() {
  for (const key of OMIE_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreOmieEnv(previous: Record<(typeof OMIE_ENV_KEYS)[number], string | undefined>) {
  for (const key of OMIE_ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createTestPkcs12(passphrase: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01T00:00:00.000Z");
  cert.validity.notAfter = new Date("2027-01-01T00:00:00.000Z");
  cert.setSubject([{ name: "commonName", value: "OMIE SIOM2 Client Test" }]);
  cert.setIssuer([{ name: "commonName", value: "OMIE SIOM2 Client Test" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, passphrase, {
    algorithm: "3des",
    friendlyName: "omie-siom2-client-test",
    generateLocalKeyId: true
  });

  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}
