import { Logger } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { CheckInNoticeService } from './checkinNotice.service';

const TODAY = new Date('2026-11-17T15:00:00.000Z');

function invoice(
  dueDate: string,
  status: InvoiceStatus = InvoiceStatus.PENDING,
) {
  return {
    id: `inv-${dueDate}-${status}`,
    status,
    externalId: 'pay_1',
    dueDate: new Date(`${dueDate}T00:00:00.000Z`),
  };
}

function makeDeps() {
  return {
    academias: { findOwnerId: jest.fn().mockResolvedValue('owner-1') },
    accounts: {
      findActiveByUser: jest.fn().mockResolvedValue({ id: 'account-1' }),
    },
    invoices: {
      findOpenAndOverdueByClient: jest.fn().mockResolvedValue([]),
    },
    clock: { now: jest.fn().mockReturnValue(TODAY) },
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new CheckInNoticeService(
    deps.academias as never,
    deps.accounts as never,
    deps.invoices as never,
    deps.clock as never,
  );
}

describe('CheckInNoticeService', () => {
  it('UT-087 a fee open and due yesterday gives the neutral notice, read from the gym owner’s accounts', async () => {
    const deps = makeDeps();
    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([
      invoice('2026-11-16'),
    ]);

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBe('SEE_ADMINISTRATION');
    expect(deps.invoices.findOpenAndOverdueByClient).toHaveBeenCalledWith(
      'client-1',
      'owner-1',
    );
  });

  it('UT-088 a student with no fees has no notice', async () => {
    const deps = makeDeps();

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBeNull();
  });

  it('UT-089 a fee due today and a pending fee due tomorrow give no notice', async () => {
    const deps = makeDeps();
    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([
      invoice('2026-11-17'),
      invoice('2026-11-18'),
    ]);

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBeNull();
  });

  it('UT-089 the due date is compared with the Brasília day, not the UTC one', async () => {
    const deps = makeDeps();
    deps.clock.now.mockReturnValue(new Date('2026-11-17T02:59:59.000Z'));
    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([
      invoice('2026-11-16'),
    ]);

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBeNull();
  });

  it('UT-090 a failing fee lookup gives no notice, no exception and a warning', async () => {
    const deps = makeDeps();
    deps.invoices.findOpenAndOverdueByClient.mockRejectedValue(
      new Error('database down'),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('checkin_notice_lookup_failed'),
    );
    warn.mockRestore();
  });

  it('UT-091 a gym owner with no billing account gives no notice and reads no fee', async () => {
    const deps = makeDeps();
    deps.accounts.findActiveByUser.mockResolvedValue(null);

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBeNull();
    expect(deps.invoices.findOpenAndOverdueByClient).not.toHaveBeenCalled();
  });

  it('UT-094 paid, manually paid and canceled fees past their due date give no notice', async () => {
    const deps = makeDeps();
    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([
      invoice('2026-10-01', InvoiceStatus.PAID),
      invoice('2026-10-02', InvoiceStatus.PAID_MANUALLY),
      invoice('2026-10-03', InvoiceStatus.CANCELED),
    ]);

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBeNull();
  });

  it('UT-096 with two overdue fees the notice stays until the last one is settled', async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const a = invoice('2026-10-01', InvoiceStatus.OVERDUE);
    const b = invoice('2026-10-10', InvoiceStatus.OVERDUE);

    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([a, b]);
    expect(await service.noticeFor('client-1', 'academia-1')).toBe(
      'SEE_ADMINISTRATION',
    );

    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([b]);
    expect(await service.noticeFor('client-1', 'academia-1')).toBe(
      'SEE_ADMINISTRATION',
    );

    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([]);
    expect(await service.noticeFor('client-1', 'academia-1')).toBeNull();
  });

  it('an unconfirmed reservation never gives a notice', async () => {
    const deps = makeDeps();
    deps.invoices.findOpenAndOverdueByClient.mockResolvedValue([
      { ...invoice('2026-10-01'), externalId: null },
    ]);

    const notice = await makeService(deps).noticeFor('client-1', 'academia-1');

    expect(notice).toBeNull();
  });
});
