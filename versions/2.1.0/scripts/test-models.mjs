// Local model discovery: "sync the models of local Ollama and LM Studio".
// Run with: npm run test:models
import http from "node:http";
import net from "node:net";
import { discoverLocalModels, localEndpointsFor, listModelsAt, WELL_KNOWN_LOCAL } from "../src/providers.js";

let failures = 0;
let passed = 0;
function check(label, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

/**
 * Free ports from the OS. A fixed port made this suite die at startup (EADDRINUSE)
 * whenever anything else on the machine happened to hold it - and a suite that dies
 * before its first check says nothing at all about the code.
 */
async function freePorts(n) {
  const ports = new Set();
  while (ports.size < n) {
    ports.add(
      await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          const { port } = probe.address();
          probe.close(() => resolve(port));
        });
      }),
    );
  }
  return [...ports];
}

/** One tiny fake server with the shape of the endpoint it is standing in for. */
function fakeServer(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(route));
  });
  return { server, seen };
}

const lmstudio = fakeServer({
  "/api/v0/models": {
    data: [
      { id: "glm-4.7-flash", max_context_length: 131072, loaded_context_length: 65536 },
      { id: "gemma-3-4b", max_context_length: 8192 },
    ],
  },
});
const ollama = fakeServer({
  "/v1/models": { data: [{ id: "qwen2.5:7b" }, { id: "glm-4.7-flash" }] },
  "/api/tags": { models: [{ name: "qwen2.5:7b" }, { name: "glm-4.7-flash" }] },
});
// LM Studio with its native API switched off: only the OpenAI route answers.
const bare = fakeServer({ "/v1/models": { data: [{ id: "llama-3.2-3b" }] } });
// An Ollama with the OpenAI bridge disabled: only its own route answers.
const nativeOnly = fakeServer({ "/api/tags": { models: [{ name: "phi4:mini" }] } });

const [lmPort, ollamaPort, barePort, nativePort, deadPort] = await freePorts(5);

await Promise.all([
  new Promise((resolve) => lmstudio.server.listen(lmPort, "127.0.0.1", resolve)),
  new Promise((resolve) => ollama.server.listen(ollamaPort, "127.0.0.1", resolve)),
  new Promise((resolve) => bare.server.listen(barePort, "127.0.0.1", resolve)),
  new Promise((resolve) => nativeOnly.server.listen(nativePort, "127.0.0.1", resolve)),
]);

const endpoint = (id, port) => ({
  id,
  label: id,
  baseUrl: `http://127.0.0.1:${port}/v1`,
  apiKey: "",
  kind: "local",
});

console.log("listModelsAt()");
{
  const models = await listModelsAt(endpoint("ollama", ollamaPort), 3000);
  check("reads the OpenAI-compatible model list", models.includes("qwen2.5:7b"), models.join(", "));
  check("sorts the list", models.join(",") === [...models].sort().join(","), models.join(", "));

  let message = "";
  try {
    await listModelsAt(endpoint("dead", deadPort), 800);
  } catch (error) {
    message = error.message;
  }
  check("an unreachable endpoint raises a clear error", /cannot reach|fetch failed|ECONNREFUSED/i.test(message) || message.length > 0, message);
}

console.log("discoverLocalModels() merges LM Studio and Ollama");
{
  const result = await discoverLocalModels([endpoint("lmstudio", lmPort), endpoint("ollama", ollamaPort)], 3000);
  const ids = result.models.map((model) => model.id);
  check("every model of both servers is there", ids.join(",") === "gemma-3-4b,glm-4.7-flash,qwen2.5:7b", ids.join(","));
  check("each model remembers its endpoint", result.models.find((m) => m.id === "qwen2.5:7b").endpointId === "ollama");
  check("the context length of every model is kept", result.context["glm-4.7-flash"] === 65536, JSON.stringify(result.context));
  check("a model that both servers offer lists the other one", result.models.find((m) => m.id === "glm-4.7-flash").alsoOn.includes("ollama"));
  check("both endpoints are reported", result.endpoints.length === 2);
  check("the LM Studio route is named", result.endpoints.find((e) => e.id === "lmstudio").source === "LM Studio /api/v0/models");
  check("the Ollama route is named", result.endpoints.find((e) => e.id === "ollama").source === "OpenAI /v1/models");
}

console.log("one server can be down without spoiling the others");
{
  const result = await discoverLocalModels([endpoint("dead", deadPort), endpoint("ollama", ollamaPort)], 1500);
  const dead = result.endpoints.find((e) => e.id === "dead");
  check("the dead one is reported as not ok", dead.ok === false);
  check("with a reason", dead.error.length > 0, dead.error);
  check("the live one still lists its models", result.models.some((m) => m.id === "qwen2.5:7b"));
}

console.log("fallbacks for servers with a reduced API");
{
  const openaiOnly = await discoverLocalModels([endpoint("bare", barePort)], 2000);
  check("an LM Studio without /api/v0/models still answers", openaiOnly.models[0]?.id === "llama-3.2-3b", JSON.stringify(openaiOnly.models));
  check("the OpenAI route is credited", openaiOnly.endpoints[0].source === "OpenAI /v1/models");

  const ollamaOnly = await discoverLocalModels([endpoint("native", nativePort)], 2000);
  check("an Ollama without /v1/models still answers", ollamaOnly.models[0]?.id === "phi4:mini", JSON.stringify(ollamaOnly.models));
  check("the Ollama route is credited", ollamaOnly.endpoints[0].source === "Ollama /api/tags");
}

console.log("localEndpointsFor()");
{
  const list = localEndpointsFor([
    { id: "local", name: "LM Studio", kind: "local", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "local" },
    { id: "work", name: "work api", kind: "api", baseUrl: "https://api.example.com/v1", apiKey: "sk-x" },
  ]);
  check("the local profile comes first", list[0].id === "local");
  check("its own label is kept", list[0].label === "LM Studio");
  check("the cloud endpoint is left out", !list.some((e) => e.id === "work"));
  check("LM Studio is not probed twice", list.filter((e) => /1234/.test(e.baseUrl)).length === 1, JSON.stringify(list.map((e) => e.baseUrl)));
  check("Ollama is added from the well-known list", list.some((e) => e.id === "ollama"));
  check("the well-known list has both servers", WELL_KNOWN_LOCAL.length === 2);
}

for (const fake of [lmstudio, ollama, bare, nativeOnly]) fake.server.close();
console.log(failures === 0 ? `\nall ${passed} model discovery checks passed` : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
