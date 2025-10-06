export default function TenantLogin({ params }: { params: { tenantId: string } }) {
  return <main style={{padding: 24}}>Login tenant: {params.tenantId}</main>;
}
