import { NextResponse } from 'next/server';
import { loadSimulationBundle, PanelNotFoundError, requireLeadInScope, toPaymentView, toView } from '@mvp/db/panel';
import { buildPaymentPdf, buildSimulationPdf, pdfFileName } from '@mvp/presentation';
import { can, leadScope } from '@/lib/permissions';
import { getDb, getUser } from '@/lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PDF da simulação, refeito da simulação gravada (os valores são os que o motor calculou). Só para quem vê o lead. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; simId: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse('Não autenticado', { status: 401 });
  if (!can(user.role, 'leads:read')) return new NextResponse('Sem permissão', { status: 403 });
  const { id, simId } = await params;
  if (!UUID.test(simId)) return new NextResponse('Não encontrado', { status: 404 });
  const db = getDb();
  try {
    await requireLeadInScope(db, id, leadScope(user));
    const bundle = await loadSimulationBundle(db, simId).catch(() => null);
    if (!bundle || bundle.lead.id !== id) return new NextResponse('Não encontrado', { status: 404 });
    const view = bundle.payment ? toPaymentView(bundle) : toView(bundle);
    const data = 'kind' in view ? await buildPaymentPdf(view) : await buildSimulationPdf(view);
    return new NextResponse(Buffer.from(data), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdfFileName(view)}"`, 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    if (err instanceof PanelNotFoundError) return new NextResponse('Não encontrado', { status: 404 });
    throw err;
  }
}
