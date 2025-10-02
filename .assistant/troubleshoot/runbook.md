# Troubleshooting Runbook

## API refuses to start: `OPAL_BEARER_TOKEN must be set to a non-default value before starting the service.`
- **Symptom**: Container exits immediately and logs the above error when launching the API (common in Portainer/Docker deployments).
- **Steps**:
  1. Generate a token: `openssl rand -hex 32` (or pull from your secret manager).
  2. Update the deployment environment (Portainer stack, `.env`, Kubernetes secret) to set `OPAL_BEARER_TOKEN` to the generated value.
  3. Redeploy/restart the service so the new environment variable is loaded.
- **Resolution**: Service boots successfully once the runtime detects a non-default bearer token.
- **Tags**: auth, secrets, deployment
