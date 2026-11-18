import { CodedError } from '@/common/errors/codedError';
import { ProductType } from '@prisma/client';
import type { BillingOwner } from './types/billingOwner';
import type { BillingSubject } from './types/billingSubject';
import type { ClientScope } from './types/clientScope';

const PROFESSIONAL_TYPES: ProductType[] = [
  ProductType.PHYSICAL_EDUCATOR,
  ProductType.NUTRITIONIST,
];

const NOT_BILLING_OWNER =
  'Apenas profissionais independentes e donos de academia acessam este recurso.';

export function notBillingOwner(): CodedError {
  return new CodedError(NOT_BILLING_OWNER, 403, 'not_billing_owner');
}

// Resolves who is billing from the authenticated user (ADR-008): an
// independent educator/nutritionist, or the owner of an academia. Anyone else
// (a student, a gym owner row without its academia, a receptionist) is not a
// billing owner.
export function resolveBillingOwner(user: BillingSubject): BillingOwner {
  const type = user.product?.type;
  if (type && PROFESSIONAL_TYPES.includes(type)) {
    return { ownerId: user.id, kind: 'PROFESSIONAL', academiaId: null };
  }
  if (type === ProductType.ACADEMIA && user.academiaId) {
    return { ownerId: user.id, kind: 'GYM', academiaId: user.academiaId };
  }
  throw notBillingOwner();
}

// The single place that decides whose student a client is for billing:
// a professional owns only independent clients, a gym owner only the clients
// of its own academia. An employed educator therefore owns no gym student.
export function ownsClient(owner: BillingOwner, client: ClientScope): boolean {
  if (owner.kind === 'GYM') {
    return client.academiaId !== null && client.academiaId === owner.academiaId;
  }
  return client.professionalId === owner.ownerId && client.academiaId === null;
}

// Reading a student's billing tab: a professional keeps seeing the student
// they invoiced before the student joined a gym (those legacy invoices stay
// theirs), while a gym owner reads only its own academia's students.
export function canViewClientBilling(
  owner: BillingOwner,
  client: ClientScope,
): boolean {
  if (owner.kind === 'PROFESSIONAL') {
    return client.professionalId === owner.ownerId;
  }
  return ownsClient(owner, client);
}
