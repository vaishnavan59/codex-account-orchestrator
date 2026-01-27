import http from "http";

import { AccountPool } from "./account_pool";
import { GatewayConfig } from "./gateway_config";
import { OpenAiGateway } from "./openai_gateway";

export function startGatewayServer(pool: AccountPool, config: GatewayConfig): http.Server {
  const gateway = new OpenAiGateway(pool, config);

  const server = http.createServer(async (req, res) => {
    try {
      await gateway.handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "gateway_error";
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(message);
    }
  });

  server.listen(config.port, config.bindAddress);

  return server;
}
