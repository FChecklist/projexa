import VendorObjectClient from "@/components/VendorObjectClient";

export default async function VendorObjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex-1">
      <VendorObjectClient vendorId={id} />
    </div>
  );
}
