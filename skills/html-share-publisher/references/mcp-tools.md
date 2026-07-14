# HTML Share MCP Tool Contract

The execution server exposes eight tools:

- `auth_status`: read or complete local delegated authorization.
- `start_login`: create a one-time DingTalk authorization URL.
- `revoke_authorization`: revoke the current delegated token and clear local credentials.
- `precheck_package`: package and validate a local source without publishing.
- `find_sites`: find sites the current user can manage.
- `resolve_contacts`: resolve people and departments to stable IDs.
- `prepare_publish`: validate all choices and create a 15-minute confirmation plan without remote writes.
- `execute_publish`: execute one confirmed plan, publish a new version, and write the source-specific local manifest.

All tools return structured JSON. When `status` is `error`, use `code`, `message`, and `recovery` to guide the next user interaction. Do not work around `AUTH_REQUIRED`, `ENTRY_REQUIRED`, `UPDATE_TARGET_REQUIRED`, `CONFIRMATION_REQUIRED`, `SOURCE_CHANGED`, or permission errors.

`permissions` passed to `prepare_publish` must use the exact objects returned by `resolve_contacts`:

```json
{
  "scopeType": "user or department",
  "scopeId": "stable DingTalk identifier",
  "scopeName": "display name"
}
```

The three access policies are `collaborators`, `company_link`, and `external_link`. External access always has a password and a future expiry. The server generates a password and a 90-day expiry when omitted.
