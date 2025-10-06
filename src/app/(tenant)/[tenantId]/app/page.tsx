export default function TenantAppHome({ params }: { params: { tenantId: string } }) {
  return (
    <main style={{padding: 24}}>
      <h1>Área Cliente — tenant: {params.tenantId}</h1>
    </main>
  );
}
