export type ApprovalBindingFields = {
  walletId: string;
  transactionId: string;
  digest: string;
  policyVersion: number;
  expiresAt: string;
  requester: string;
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function binding(auth: ApprovalBindingFields): ApprovalBindingFields {
  return {
    walletId: auth.walletId,
    transactionId: auth.transactionId,
    digest: auth.digest,
    policyVersion: auth.policyVersion,
    expiresAt: auth.expiresAt,
    requester: auth.requester,
  };
}
export function approvalText(auth: ApprovalBindingFields) {
  return canonical({ domain: 'quorum-custody/approval/v1', ...binding(auth) });
}
