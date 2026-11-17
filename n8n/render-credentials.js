// Renders the n8n credentials this project needs from environment variables.
// Output goes straight to `n8n import:credentials`, which encrypts it with N8N_ENCRYPTION_KEY;
// nothing secret is written to the repository.
const env = process.env;

const credentials = [
  {
    id: "LeadflowPgCred01",
    name: "leadflow-postgres",
    type: "postgres",
    data: {
      host: env.POSTGRES_HOST || "postgres",
      port: 5432,
      database: "leadflow",
      user: env.POSTGRES_USER || "leadflow",
      password: env.POSTGRES_PASSWORD,
      ssl: "disable",
      allowUnauthorizedCerts: false,
      sshTunnel: false,
    },
  },
  {
    id: "LeadflowApiKey01",
    name: "anthropic-api-key",
    type: "httpHeaderAuth",
    // Sent as the x-api-key header by the "Claude: classify" node. Unused in mock mode.
    data: { name: "x-api-key", value: env.ANTHROPIC_API_KEY || "not-set" },
  },
];

if (!env.POSTGRES_PASSWORD) {
  console.error("POSTGRES_PASSWORD is not set");
  process.exit(1);
}
process.stdout.write(JSON.stringify(credentials));
