# Troubleshooting Runbook

## API refuses to start: `OPAL_BEARER_TOKEN must be set to a non-default value before starting the service.`
- **Symptom**: Container exits immediately and logs the above error when launching the API (common in Portainer/Docker deployments).
- **Steps**:
  1. Generate a token: `openssl rand -hex 32` (or pull from your secret manager).
  2. Update the deployment environment (Portainer stack, `.env`, Kubernetes secret) to set `OPAL_BEARER_TOKEN` to the generated value.
  3. Redeploy/restart the service so the new environment variable is loaded.
- **Resolution**: Service boots successfully once the runtime detects a non-default bearer token.
- **Tags**: auth, secrets, deployment

## Portainer stack fails with `Head ... denied` when pulling `ghcr.io/authorityab/opalmind-api`
- **Symptom**: Portainer shows `denied` or `unauthorized: authentication required` while trying to deploy the stack, and the Docker daemon cannot pull the image from GitHub Container Registry.
- **Steps**:
  1. Generate a GitHub Personal Access Token (classic) with at least the `read:packages` scope (Settings → Developer settings → Personal access tokens → Tokens (classic)).
  2. In Portainer, open **Registries** → **Add registry**, choose **Custom**, set the registry URL to `https://ghcr.io`, enter your GitHub username, and paste the PAT as the password. Save the registry entry.
  3. When redeploying the stack, select the saved registry (or ensure it is the default) so Portainer passes the credentials to Docker. Alternatively, run `docker login ghcr.io` on the host with the same username/PAT before Portainer executes the stack.
  4. Re-deploy the stack. The image pull should succeed once registry authentication is configured.
- **Resolution**: Docker can pull `ghcr.io/authorityab/opalmind-api` after authenticating with GHCR using a PAT that has package read access.
- **Tags**: deployment, registry, auth
