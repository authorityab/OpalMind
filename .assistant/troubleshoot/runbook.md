# Troubleshooting Runbook

## API refuses to start: `MATOMO_BASE_URL must be set before starting the service.`
- **Symptom**: Service exits during boot with the above error (or a similar message about `MATOMO_TOKEN` / `MATOMO_DEFAULT_SITE_ID`) after the configuration guard was added.
- **Steps**:
  1. Verify the deployment environment (Docker Compose variables, Kubernetes secrets, etc.) provides a real Matomo base URL via `MATOMO_BASE_URL` (including protocol).
  2. Ensure `MATOMO_TOKEN` contains the Matomo `token_auth` value and is not left as the scaffold placeholder.
  3. If a default site ID is configured, confirm `MATOMO_DEFAULT_SITE_ID` parses as an integer; otherwise remove the variable so the service relies on caller-provided site IDs.
  4. Redeploy/restart the service once the environment variables are corrected.
- **Resolution**: Service boots successfully with the validated configuration.
- **Tags**: config, deployment

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

## Health status alert triggered by monitoring
- **Symptom**: `/tools/get-health-status` alert fires (status `degraded` or `unhealthy`) from Grafana/Prometheus/DataDog pollers.
- **Steps**:
  1. Inspect the failing checks in the response payload captured by the monitor (e.g., `matomo-api`, `reports-cache`, `tracking-queue`).
  2. For `matomo-api` failures: test Matomo connectivity manually with `curl "$MATOMO_BASE_URL?module=API&method=API.getMatomoVersion&token_auth=$MATOMO_TOKEN"` to confirm credentials and network.
  3. For `reports-cache` warnings: check service logs for cache hit/miss imbalance, clear stale cache entries if necessary, and confirm traffic patterns.
  4. For `tracking-queue` failures: review queue depth via `client.getTrackingRequestMetadata` (or logs), ensure downstream Matomo tracking endpoints are responding, and scale workers if needed.
  5. Once mitigated, acknowledge the alert in the monitoring system and verify the endpoint returns `healthy`.
- **Resolution**: Alert clears after the underlying check recovers and `/tools/get-health-status` reports `healthy`.
- **Tags**: monitoring, matomo, cache, tracking
