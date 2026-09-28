#!/usr/bin/env bash
#
# provision.sh -- stand up the whole Azure footprint for ai-builder-mvp.
#
# Idempotent: every step checks for the resource first, so you can re-run this
# after a failure without cleaning anything up by hand.
#
#   cp infra/azure.env.example infra/azure.env   # edit it first
#   ./infra/provision.sh                          # everything
#   ./infra/provision.sh secrets                  # just re-push the API keys
#   ./infra/provision.sh deploy                   # just rebuild + redeploy
#   ./infra/provision.sh auth                     # just (re)configure Entra sign-in
#   ./infra/provision.sh github                   # just wire GitHub Actions OIDC
#
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="infra/azure.env"

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE -- copy infra/azure.env.example and edit it."; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m ok\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m !\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------------------
# 0. Preflight
# --------------------------------------------------------------------------
preflight() {
  say "Preflight"
  command -v az >/dev/null || die "Azure CLI not found. brew install azure-cli"
  az account show >/dev/null 2>&1 || die "Not signed in. Run: az login"

  SUBSCRIPTION_ID=$(az account show --query id -o tsv)
  TENANT_ID=$(az account show --query tenantId -o tsv)
  SIGNED_IN_USER=$(az ad signed-in-user show --query id -o tsv)
  export SUBSCRIPTION_ID TENANT_ID SIGNED_IN_USER
  ok "subscription $SUBSCRIPTION_ID  tenant $TENANT_ID"

  az extension show --name containerapp >/dev/null 2>&1 \
    || az extension add --name containerapp --only-show-errors
  # These are one-time per subscription and take a minute the first time.
  for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.Storage; do
    state=$(az provider show -n "$ns" --query registrationState -o tsv 2>/dev/null || echo "")
    if [[ "$state" != "Registered" ]]; then
      warn "registering provider $ns (one time, ~1 min)"
      az provider register -n "$ns" --wait --only-show-errors
    fi
  done
  ok "resource providers registered"
}

# --------------------------------------------------------------------------
# 1. Core resources: group, registry, storage, vault, identity
# --------------------------------------------------------------------------
core() {
  say "Resource group: $RESOURCE_GROUP"
  az group create -n "$RESOURCE_GROUP" -l "$LOCATION" -o none
  ok "$RESOURCE_GROUP in $LOCATION"

  say "Container registry: $ACR_NAME"
  if ! az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    # Basic tier is plenty for one app. Admin user stays OFF -- the app pulls
    # with its managed identity instead of a stored username/password.
    az acr create -n "$ACR_NAME" -g "$RESOURCE_GROUP" --sku Basic --admin-enabled false -o none
  fi
  ok "$ACR_NAME.azurecr.io"

  say "Managed identity: $IDENTITY_NAME"
  if ! az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    az identity create -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" -o none
  fi
  IDENTITY_ID=$(az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
  IDENTITY_PRINCIPAL=$(az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query principalId -o tsv)
  IDENTITY_CLIENT_ID=$(az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query clientId -o tsv)
  export IDENTITY_ID IDENTITY_PRINCIPAL IDENTITY_CLIENT_ID
  ok "principal $IDENTITY_PRINCIPAL"

  say "Storage account + file share"
  if ! az storage account show -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    az storage account create \
      -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" -l "$LOCATION" \
      --kind StorageV2 --sku Standard_LRS \
      --enable-large-file-share \
      --min-tls-version TLS1_2 \
      --allow-blob-public-access false \
      -o none
  fi
  az storage share-rm create \
    -g "$RESOURCE_GROUP" --storage-account "$STORAGE_ACCOUNT" \
    -n "$FILE_SHARE" --quota 100 --enabled-protocols SMB -o none 2>/dev/null || true
  ok "$STORAGE_ACCOUNT/$FILE_SHARE"

  say "Key Vault: $KEYVAULT_NAME"
  if ! az keyvault show -n "$KEYVAULT_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    az keyvault create \
      -n "$KEYVAULT_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" \
      --enable-rbac-authorization true \
      --retention-days 7 \
      -o none
  fi
  VAULT_ID=$(az keyvault show -n "$KEYVAULT_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
  export VAULT_ID

  # You need to be able to write secrets; the app needs to read them.
  assign_role "Key Vault Secrets Officer" "$SIGNED_IN_USER" "$VAULT_ID" User
  assign_role "Key Vault Secrets User"    "$IDENTITY_PRINCIPAL" "$VAULT_ID" ServicePrincipal
  assign_role "AcrPull" "$IDENTITY_PRINCIPAL" \
    "$(az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)" ServicePrincipal
  ok "RBAC assigned (can take ~1 min to propagate)"
}

assign_role() {
  local role="$1" principal="$2" scope="$3" ptype="$4"
  if ! az role assignment list --assignee "$principal" --scope "$scope" \
        --query "[?roleDefinitionName=='$role'] | length(@)" -o tsv 2>/dev/null | grep -q '^[1-9]'; then
    az role assignment create \
      --role "$role" --assignee-object-id "$principal" \
      --assignee-principal-type "$ptype" --scope "$scope" -o none
  fi
}

# --------------------------------------------------------------------------
# 2. Secrets -- prompted, written to Key Vault, never echoed or written to disk
# --------------------------------------------------------------------------
secrets() {
  say "Application secrets -> Key Vault"
  VAULT_ID=${VAULT_ID:-$(az keyvault show -n "$KEYVAULT_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)}

  put_secret anthropic-api-key   "ANTHROPIC_API_KEY (from console.anthropic.com)" required
  put_secret openai-api-key      "OPENAI_API_KEY (optional -- blank disables the Codex agent)" optional
  put_secret github-app-id       "GITHUB_APP_ID (optional -- blank disables GitHub export)" optional
  put_secret github-app-slug     "GITHUB_APP_SLUG (optional)" optional

  # WORKSPACE_SECRET_KEY is generated, not typed -- one less thing to leak.
  if ! az keyvault secret show --vault-name "$KEYVAULT_NAME" -n workspace-secret-key >/dev/null 2>&1; then
    az keyvault secret set --vault-name "$KEYVAULT_NAME" -n workspace-secret-key \
      --value "$(openssl rand -base64 32)" -o none
    ok "workspace-secret-key generated"
  else
    ok "workspace-secret-key already set"
  fi

  # The GitHub App private key is a multi-line PEM. Point at the .pem file you
  # downloaded from GitHub; it is converted to the literal-\n form the app expects.
  if ! az keyvault secret show --vault-name "$KEYVAULT_NAME" -n github-app-private-key >/dev/null 2>&1; then
    read -r -p "    Path to GitHub App private key .pem (blank to skip): " PEM_PATH
    if [[ -n "${PEM_PATH:-}" && -f "$PEM_PATH" ]]; then
      az keyvault secret set --vault-name "$KEYVAULT_NAME" -n github-app-private-key \
        --value "$(awk '{printf "%s\\n", $0}' "$PEM_PATH")" -o none
      ok "github-app-private-key stored"
    else
      warn "skipped github-app-private-key"
    fi
  else
    ok "github-app-private-key already set"
  fi
}

put_secret() {
  local name="$1" prompt="$2" mode="$3"
  if az keyvault secret show --vault-name "$KEYVAULT_NAME" -n "$name" >/dev/null 2>&1; then
    ok "$name already set (delete it in the portal to change)"
    return
  fi
  read -r -s -p "    $prompt: " value; echo
  if [[ -z "$value" ]]; then
    [[ "$mode" == required ]] && die "$name is required."
    warn "skipped $name"
    return
  fi
  az keyvault secret set --vault-name "$KEYVAULT_NAME" -n "$name" --value "$value" -o none
  ok "$name stored"
}

# --------------------------------------------------------------------------
# 3. Container Apps environment + the Azure Files mount
# --------------------------------------------------------------------------
environment() {
  say "Container Apps environment: $ENVIRONMENT_NAME"
  if ! az containerapp env show -n "$ENVIRONMENT_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    az containerapp env create \
      -n "$ENVIRONMENT_NAME" -g "$RESOURCE_GROUP" -l "$LOCATION" -o none
  fi
  ok "$ENVIRONMENT_NAME"

  say "Registering the file share as a storage mount"
  # Container Apps has no managed-identity path to Azure Files -- the account
  # key is the only option. It stays inside the environment resource.
  local key
  key=$(az storage account keys list -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" --query "[0].value" -o tsv)
  az containerapp env storage set \
    -n "$ENVIRONMENT_NAME" -g "$RESOURCE_GROUP" \
    --storage-name "$STORAGE_MOUNT_NAME" \
    --storage-type AzureFile \
    --azure-file-account-name "$STORAGE_ACCOUNT" \
    --azure-file-account-key "$key" \
    --azure-file-share-name "$FILE_SHARE" \
    --access-mode ReadWrite \
    -o none
  ok "$STORAGE_MOUNT_NAME -> $FILE_SHARE"
}

# --------------------------------------------------------------------------
# 4. Build the image in Azure (no local Docker needed) and deploy
# --------------------------------------------------------------------------
deploy() {
  say "Building image in ACR (this runs the build on Azure, not your Mac)"
  local tag="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
  local image="$ACR_NAME.azurecr.io/ai-builder-mvp:$tag"
  az acr build -r "$ACR_NAME" -t "ai-builder-mvp:$tag" -t "ai-builder-mvp:latest" . -o none
  ok "$image"

  IDENTITY_ID=${IDENTITY_ID:-$(az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)}

  say "Deploying container app: $APP_NAME"
  if ! az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    az containerapp create \
      -n "$APP_NAME" -g "$RESOURCE_GROUP" \
      --environment "$ENVIRONMENT_NAME" \
      --image "$image" \
      --registry-server "$ACR_NAME.azurecr.io" \
      --registry-identity "$IDENTITY_ID" \
      --user-assigned "$IDENTITY_ID" \
      --target-port 3000 \
      --ingress external \
      --transport auto \
      --cpu 1.0 --memory 2.0Gi \
      --min-replicas 0 --max-replicas 1 \
      -o none
  fi

  write_app_yaml "$image"
  az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" --yaml /tmp/ai-builder-app.yaml -o none
  rm -f /tmp/ai-builder-app.yaml

  APP_FQDN=$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv)
  export APP_FQDN
  ok "https://$APP_FQDN"
}

# max-replicas is pinned to 1 on purpose: SQLite and the workspace git repos
# assume a single writer. Do not raise it without moving to Postgres first.
write_app_yaml() {
  local image="$1"
  local vault="https://$KEYVAULT_NAME.vault.azure.net/secrets"
  IDENTITY_ID=${IDENTITY_ID:-$(az identity show -n "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)}

  # Only reference secrets that actually exist, so a partial setup still deploys.
  local secret_lines="" env_lines=""
  add_secret() {
    local key="$1" envname="$2"
    if az keyvault secret show --vault-name "$KEYVAULT_NAME" -n "$key" >/dev/null 2>&1; then
      secret_lines+="    - name: $key"$'\n'"      keyVaultUrl: $vault/$key"$'\n'"      identity: $IDENTITY_ID"$'\n'
      env_lines+="        - name: $envname"$'\n'"          secretRef: $key"$'\n'
    fi
  }
  add_secret anthropic-api-key       ANTHROPIC_API_KEY
  add_secret openai-api-key          OPENAI_API_KEY
  add_secret workspace-secret-key    WORKSPACE_SECRET_KEY
  add_secret github-app-id           GITHUB_APP_ID
  add_secret github-app-slug         GITHUB_APP_SLUG
  add_secret github-app-private-key  GITHUB_APP_PRIVATE_KEY

  cat > /tmp/ai-builder-app.yaml <<YAML
properties:
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 3000
      transport: auto
      allowInsecure: false
    secrets:
${secret_lines}
  template:
    containers:
      - name: app
        image: $image
        resources:
          cpu: 1.0
          memory: 2.0Gi
        env:
        - name: NODE_ENV
          value: production
        - name: PORT
          value: "3000"
        # One mount covers both: src/lib/db/index.ts puts app.db in the parent
        # directory of WORKSPACES_ROOT.
        - name: WORKSPACES_ROOT
          value: /mnt/appdata/workspaces
        # SQLite WAL needs shared memory that SMB file shares do not provide.
        # See docs/azure-deployment.md "Why not WAL".
        - name: SQLITE_JOURNAL_MODE
          value: DELETE
        # Tells src/lib/identity.ts that the Container Apps auth sidecar is
        # in front of us, so the X-MS-CLIENT-PRINCIPAL-* headers can be
        # trusted. Never set this anywhere the proxy is not present.
        - name: TRUST_AUTH_HEADERS
          value: "1"
        # Who may see the admin feedback inbox and funnel. Full ids as
        # currentUserId() returns them, comma-separated. Empty = nobody.
        - name: ADMIN_USER_IDS
          value: "${ADMIN_USER_IDS:-}"
${env_lines}        volumeMounts:
        - volumeName: appdata
          mountPath: /mnt/appdata
    scale:
      minReplicas: 0
      maxReplicas: 1
    volumes:
    - name: appdata
      storageName: $STORAGE_MOUNT_NAME
      storageType: AzureFile
YAML
}

# --------------------------------------------------------------------------
# 5. Lock the front door: Microsoft Entra sign-in, this tenant only
# --------------------------------------------------------------------------
auth() {
  APP_FQDN=${APP_FQDN:-$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv)}
  [[ -n "$APP_FQDN" ]] || die "Deploy the app first -- no ingress FQDN yet."

  say "Entra ID app registration for sign-in"
  local reg_name="${APP_NAME}-auth"
  local redirect="https://$APP_FQDN/.auth/login/aad/callback"
  local app_id
  app_id=$(az ad app list --display-name "$reg_name" --query "[0].appId" -o tsv)
  if [[ -z "$app_id" ]]; then
    # AzureADMyOrg = single tenant. Nobody outside your directory can even
    # reach the sign-in form, let alone the app.
    app_id=$(az ad app create \
      --display-name "$reg_name" \
      --sign-in-audience AzureADMyOrg \
      --web-redirect-uris "$redirect" \
      --enable-id-token-issuance true \
      --query appId -o tsv)
    ok "created app registration $app_id"
  else
    az ad app update --id "$app_id" --web-redirect-uris "$redirect" --enable-id-token-issuance true -o none
    ok "reusing app registration $app_id"
  fi

  az ad sp show --id "$app_id" >/dev/null 2>&1 || az ad sp create --id "$app_id" -o none
  # "User assignment required": even inside your tenant, only people you
  # explicitly assign in Entra ID > Enterprise applications can sign in.
  az ad sp update --id "$app_id" --set appRoleAssignmentRequired=true -o none
  ok "user assignment required"

  say "Client secret + auth config"
  local client_secret
  client_secret=$(az ad app credential reset --id "$app_id" \
    --display-name containerapp --years 2 --query password -o tsv)

  az containerapp secret set -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --secrets "aad-client-secret=$client_secret" -o none

  TENANT_ID=${TENANT_ID:-$(az account show --query tenantId -o tsv)}
  az containerapp auth microsoft update -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --client-id "$app_id" \
    --client-secret-name aad-client-secret \
    --issuer "https://login.microsoftonline.com/$TENANT_ID/v2.0" \
    --allowed-token-audiences "api://$app_id" \
    --yes -o none

  # Return401 for API routes would be friendlier, but a browser-first app wants
  # the redirect. Every unauthenticated request lands on the Microsoft login page.
  az containerapp auth update -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --enabled true \
    --action RedirectToLoginPage \
    --redirect-provider AzureActiveDirectory \
    --require-https true \
    -o none

  ok "sign-in required for every request"
  warn "Assign yourself: portal > Microsoft Entra ID > Enterprise applications > $reg_name > Users and groups"
}

# --------------------------------------------------------------------------
# 5b. Name yourself admin (run after your first sign-in)
# --------------------------------------------------------------------------
# The admin id is "entra:<your object id>". You can read it straight from
# Entra rather than digging it out of a request header.
admin() {
  say "Granting admin to the signed-in user"
  local oid
  oid=$(az ad signed-in-user show --query id -o tsv)
  local value="entra:$oid"
  az containerapp update -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --set-env-vars "ADMIN_USER_IDS=$value" -o none
  ok "ADMIN_USER_IDS=$value"
  echo "    Add it to infra/azure.env so redeploys keep it:"
  echo "      ADMIN_USER_IDS=$value"
}

# --------------------------------------------------------------------------
# 6. GitHub Actions -> Azure, with OIDC (no long-lived secret in GitHub)
# --------------------------------------------------------------------------
github() {
  say "GitHub Actions federated identity"
  local gh_identity="${IDENTITY_NAME}-gh"
  if ! az identity show -n "$gh_identity" -g "$RESOURCE_GROUP" >/dev/null 2>&1; then
    az identity create -n "$gh_identity" -g "$RESOURCE_GROUP" -o none
  fi
  local gh_principal gh_client
  gh_principal=$(az identity show -n "$gh_identity" -g "$RESOURCE_GROUP" --query principalId -o tsv)
  gh_client=$(az identity show -n "$gh_identity" -g "$RESOURCE_GROUP" --query clientId -o tsv)

  # Trust exactly one repo + one branch. A PR from a fork gets nothing.
  az identity federated-credential create \
    --name "gh-${GITHUB_BRANCH}" \
    --identity-name "$gh_identity" -g "$RESOURCE_GROUP" \
    --issuer https://token.actions.githubusercontent.com \
    --subject "repo:${GITHUB_REPO}:ref:refs/heads/${GITHUB_BRANCH}" \
    --audiences api://AzureADTokenExchange -o none 2>/dev/null || ok "federated credential already exists"

  # Scoped to the resource group, not the whole subscription.
  assign_role "Contributor" "$gh_principal" \
    "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" ServicePrincipal
  assign_role "AcrPush" "$gh_principal" \
    "$(az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)" ServicePrincipal

  cat <<EOF

    Add these three repository secrets at
    https://github.com/${GITHUB_REPO}/settings/secrets/actions

      AZURE_CLIENT_ID        $gh_client
      AZURE_TENANT_ID        $TENANT_ID
      AZURE_SUBSCRIPTION_ID  $SUBSCRIPTION_ID

    And these repository variables (Variables tab, not Secrets):

      AZURE_RESOURCE_GROUP   $RESOURCE_GROUP
      AZURE_ACR_NAME         $ACR_NAME
      AZURE_APP_NAME         $APP_NAME

EOF
}

# --------------------------------------------------------------------------
main() {
  preflight
  case "${1:-all}" in
    all)         core; secrets; environment; deploy; auth; github; summary ;;
    core)        core ;;
    secrets)     secrets ;;
    environment) environment ;;
    deploy)      deploy; summary ;;
    auth)        auth ;;
    admin)       admin ;;
    github)      github ;;
    *)           die "Unknown step: $1 (all|core|secrets|environment|deploy|auth|github|admin)" ;;
  esac
}

summary() {
  APP_FQDN=${APP_FQDN:-$(az containerapp show -n "$APP_NAME" -g "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || echo "")}
  say "Done"
  echo "    App:       https://${APP_FQDN}"
  echo "    Logs:      az containerapp logs show -n $APP_NAME -g $RESOURCE_GROUP --follow"
  echo "    Tear down: az group delete -n $RESOURCE_GROUP --yes"
}

main "$@"
